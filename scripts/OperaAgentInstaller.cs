// @last-edited: 2026-10-06 01:32 UTC+7.
// @title: OperaAgentInstaller.cs — source for the Opera Agent installer window.
// @state: detects Chromium browsers, writes ExtensionInstallForcelist, reports what it did.
// @dependencies: WinForms, Drawing. Build with scripts/build-installer.ps1.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OperaAgent
{
    // One browser: where its policy hive lives and how to find its executable.
    internal sealed class BrowserTarget
    {
        public string Name;
        public string PolicyKey;
        public string Executable;
        public bool Installed;
        public bool Selected;
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }

    internal sealed class InstallerForm : Form
    {
        private const string ExtensionId = "ofgemipoobcnbjkfanmofjbdonjapmgl";
        private const string ProjectRef = "nenmkmtvjremqphfqnfw";
        private const string AppVersion = "1.6.15";

        // The x parameter is how a Chromium updater states which extension it is
        // asking about. Without it this endpoint falls back to a legacy id and
        // serves a release from September, which would install an ancient build.
        private static readonly string FeedUrl =
            "https://" + ProjectRef + ".supabase.co/functions/v1/opera-agent-update/update.xml"
            + "?x=id%3D" + ExtensionId + "%26v%3D0";

        // WHY the x parameter matters: the endpoint reads which extension the
        // updater is asking about from it, and falls back to a legacy id when it
        // is absent, which serves a September release instead of this one.

        private readonly List<BrowserTarget> _targets = new List<BrowserTarget>();
        private readonly List<CheckBox> _boxes = new List<CheckBox>();
        private readonly TextBox _log = new TextBox();
        private readonly Button _install;
        private readonly Button _cancel;
        private readonly CheckBox _all;
        private readonly ProgressBar _progress;
        private readonly Label _step;

        internal InstallerForm()
        {
            Text = "Opera Agent";
            ClientSize = new Size(560, 640);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F);

            // The header band is the same palette the site uses, so the installer
            // and the page it came from read as one product rather than a
            // generic setup dialog.
            var header = new Panel
            {
                BackColor = Color.FromArgb(20, 24, 29),
                Location = new Point(0, 0),
                Size = new Size(560, 96)
            };
            Controls.Add(header);

            var accent = new Panel
            {
                BackColor = Color.FromArgb(20, 184, 166),
                Location = new Point(0, 92),
                Size = new Size(560, 4)
            };
            Controls.Add(accent);

            var brand = new Label
            {
                Text = "Opera Agent",
                ForeColor = Color.FromArgb(232, 234, 237),
                Font = new Font("Segoe UI Semibold", 20F),
                AutoSize = true,
                Location = new Point(24, 22),
                BackColor = Color.Transparent
            };
            header.Controls.Add(brand);

            var version = new Label
            {
                Text = "Pemasang versi " + AppVersion,
                ForeColor = Color.FromArgb(154, 164, 178),
                Font = new Font("Segoe UI", 9.5F),
                AutoSize = true,
                Location = new Point(26, 58),
                BackColor = Color.Transparent
            };
            header.Controls.Add(version);

            var tagline = new Label
            {
                Text = "Tanpa Chrome Web Store",
                ForeColor = Color.FromArgb(20, 184, 166),
                Font = new Font("Segoe UI Semibold", 9.5F),
                AutoSize = true,
                Location = new Point(390, 30),
                BackColor = Color.Transparent
            };
            header.Controls.Add(tagline);

            var title = new Label
            {
                Text = "Pilih browser yang mau memakai Opera Agent.",
                AutoSize = true,
                Location = new Point(24, 116)
            };
            Controls.Add(title);

            Detect();

            int y = 148;
            if (_targets.Count == 0)
            {
                Controls.Add(new Label
                {
                    Text = "Tidak ada browser Chromium yang ditemukan.\n"
                         + "Opera Agent butuh Chrome, Edge, Brave, atau Opera.\n"
                         + "Firefox tidak mendukung pemasangan lewat cara ini.",
                    AutoSize = false,
                    Size = new Size(516, 60),
                    Location = new Point(22, y),
                    ForeColor = Color.Firebrick
                });
            }
            else
            {
                // WHY a master checkbox rather than a button: the common case is
                // one browser, and checking it should not require scrolling to a
                // separate control. It mirrors the tri-state list behaviour.
                _all = new CheckBox
                {
                    Text = "Semua browser",
                    Checked = true,
                    AutoSize = true,
                    Location = new Point(26, y)
                };
                _all.CheckedChanged += (s, e) => SetAll((CheckBox)s);
                Controls.Add(_all);
                y += 26;

                foreach (var t in _targets)
                {
                    var box = new CheckBox
                    {
                        Text = t.Name,
                        Checked = true,
                        AutoSize = true,
                        Location = new Point(46, y),
                        Tag = t
                    };
                    box.CheckedChanged += (s, e) => SingleChanged();
                    _boxes.Add(box);
                    Controls.Add(box);
                    y += 26;
                }
            }

            y += 10;
            Controls.Add(new Label
            {
                Text = "Pembaruan berikutnya dipasang sendiri oleh browser, tanpa tombol.",
                AutoSize = true,
                Location = new Point(22, y),
                ForeColor = SystemColors.GrayText
            });
            y += 30;

            _install = new Button
            {
                Text = "Pasang",
                Size = new Size(130, 38),
                Location = new Point(22, y),
                Enabled = _targets.Count > 0
            };
            _install.Click += (s, e) => Install();
            Controls.Add(_install);

            _cancel = new Button
            {
                Text = "Batal",
                Size = new Size(110, 38),
                Location = new Point(164, y)
            };
            _cancel.Click += (s, e) => Close();
            Controls.Add(_cancel);

            y += 52;
            _progress = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Location = new Point(22, y),
                Size = new Size(516, 20)
            };
            Controls.Add(_progress);

            y += 26;
            _step = new Label
            {
                Text = "Siap.",
                AutoSize = true,
                Location = new Point(22, y),
                ForeColor = SystemColors.GrayText
            };
            Controls.Add(_step);

            y += 30;
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.BackColor = Color.FromArgb(28, 30, 34);
            _log.ForeColor = Color.Gainsboro;
            _log.BorderStyle = BorderStyle.None;
            _log.Location = new Point(22, y);
            _log.Size = new Size(516, 116);
            Controls.Add(_log);

            foreach (var t in _targets) Write("Ditemukan " + t.Name + ".");
            if (_targets.Count > 0) Write("Pilih browser lalu tekan Pasang.");
        }

        private void Detect()
        {
            var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var probes = new[]
            {
                new BrowserTarget { Name = "Chrome", PolicyKey = @"Software\Policies\Google\Chrome",
                                   Executable = Path.Combine(pf, @"Google\Chrome\Application\chrome.exe") },
                new BrowserTarget { Name = "Edge", PolicyKey = @"Software\Policies\Microsoft\Edge",
                                   Executable = Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe") },
                new BrowserTarget { Name = "Brave", PolicyKey = @"Software\Policies\BraveSoftware\Brave",
                                   Executable = Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe") },
                new BrowserTarget { Name = "Opera", PolicyKey = @"Software\Policies\OperaSoftware\Opera",
                                   Executable = Path.Combine(pf, @"Opera\launcher.exe") }
            };
            foreach (var p in probes)
            {
                p.Installed = File.Exists(p.Executable);
                if (p.Installed) { p.Selected = true; _targets.Add(p); }
            }
        }

        private void SetAll(CheckBox master)
        {
            // Why not a tri-state master: CheckedState only exists from .NET
            // 4.7, and this compiles against 4.0. The partial case is expressed
            // by unchecking the master while at least one browser stays ticked.
            var turningOn = master.Checked;
            foreach (var b in _boxes) b.Checked = turningOn;
            _install.Enabled = _boxes.Any(b => b.Checked);
        }

        private void SingleChanged()
        {
            int on = _boxes.Count(b => b.Checked);
            // Keep the master honest: ticked only when every browser is ticked.
            if (_all != null && _all.Checked != (on == _boxes.Count && on > 0)) _all.Checked = on == _boxes.Count && on > 0;
            _install.Enabled = on > 0;
        }

        // WHY a thread: the registry write and the network probe both block, and
        // a frozen window during an install reads as a crash. WHY these steps:
        // each one is work that really happens, so the bar reports progress
        // rather than animating to look busy.
        private void Install()
        {
            var chosen = _targets.Where(t => t.Selected).ToList();
            if (chosen.Count == 0) return;

            _install.Enabled = false;
            _cancel.Enabled = false;
            _log.Clear();
            _progress.Style = ProgressBarStyle.Marquee;

            var worker = new System.Threading.Thread(new System.Threading.ThreadStart(delegate { Run(chosen); }));
            worker.IsBackground = true;
            worker.Start();
        }

        private void Run(List<BrowserTarget> chosen)
        {
            try
            {
                // Step 1 of 3. A browser cannot install from an unreachable feed,
                // so finding that out here beats a silent no-op later.
                Ui(delegate { SetStep("Memeriksa server…"); Write("Memeriksa jeda pembaruan…"); });
                bool reachable = ProbeFeed();
                Ui(delegate
                {
                    _progress.Style = ProgressBarStyle.Continuous;
                    if (reachable) { Write("Server menjawab, jeda pembaruan valid."); }
                    else { Write("Peringatan: server tidak menjawab. Pemasangan dilanjutkan."); }
                });

                // Step 2 of 3.
                int done = 0, failed = 0;
                foreach (var t in chosen)
                {
                    Ui(delegate { SetStep("Menulis kebijakan " + t.Name + "…"); });
                    try
                    {
                        WritePolicy(t);
                        Ui(delegate
                        {
                            Write(t.Name + ": kebijakan ditulis.");
                            done++;
                            _progress.Value = (int)(40 + 50.0 * done / Math.Max(1, chosen.Count));
                        });
                    }
                    catch (Exception ex)
                    {
                        Ui(delegate { Write(t.Name + ": gagal — " + ex.Message); failed++; });
                    }
                }

                // Step 3 of 3. Reading it back is what makes the claim "written"
                // mean the browser will find it, rather than that a call returned.
                Ui(delegate { SetStep("Memverifikasi…"); });
                int seen = 0;
                foreach (var t in chosen)
                {
                    if (HasFeed(t)) seen++;
                    else Ui(delegate { Write(t.Name + ": kebijakan tidak terbaca kembali."); });
                }

                Ui(delegate
                {
                    _progress.Value = 100;
                    SetStep(failed == 0
                        ? "Selesai. Tutup browser sepenuhnya, lalu buka lagi."
                        : "Sebagian gagal. Jalankan ulang sebagai administrator.");
                    Write("Browser terpasang: " + seen + " dari " + chosen.Count + ".");
                    _install.Enabled = true;
                    _cancel.Enabled = true;
                });

                if (failed == 0 && seen == chosen.Count)
                {
                    Ui(delegate
                    {
                        MessageBox.Show(
                            "Kebijakan sudah ditulis untuk:\n\n  " + String.Join(", ", chosen.ConvertAll(t => t.Name).ToArray())
                            + "\n\nTutup semua jendela browser, lalu buka lagi. Opera Agent terpasang saat browser mulai.",
                            "Selesai", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });
                }
            }
            catch (Exception ex)
            {
                Ui(delegate { Write("Gagal: " + ex.Message); SetStep("Gagal."); });
            }
        }

        private bool ProbeFeed()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(FeedUrl);
                request.Method = "GET";
                request.Timeout = 15000;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    string body = new StreamReader(response.GetResponseStream()).ReadToEnd();
                    return body.Contains(ExtensionId);
                }
            }
            catch
            {
                return false;
            }
        }

        private void WritePolicy(BrowserTarget t)
        {
            using (var hive = Registry.CurrentUser.OpenSubKey(t.PolicyKey, true)
                   ?? Registry.CurrentUser.CreateSubKey(t.PolicyKey))
            using (var list = hive.CreateSubKey("ExtensionInstallForcelist"))
            {
                var existing = list.GetValue("ExtensionInstallForcelist") as string[];
                var next = new List<string>();
                if (existing != null)
                {
                    // Replace our own entry instead of appending a duplicate on
                    // every run, so the list stays one line long.
                    foreach (var e in existing.Where(e => e != null && !e.Contains(ExtensionId)))
                        next.Add(e);
                }
                next.Add(FeedUrl);
                list.SetValue("ExtensionInstallForcelist", next.ToArray(), RegistryValueKind.MultiString);
            }
        }

        private bool HasFeed(BrowserTarget t)
        {
            using (var hive = Registry.CurrentUser.OpenSubKey(t.PolicyKey))
            {
                if (hive == null) return false;
                using (var list = hive.OpenSubKey("ExtensionInstallForcelist"))
                {
                    if (list == null) return false;
                    var values = list.GetValue("ExtensionInstallForcelist") as string[];
                    return values != null && values.Contains(FeedUrl);
                }
            }
        }

        private void SetStep(string text) { _step.Text = text; }

        private void Ui(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch (ObjectDisposedException) { }
        }

        private void Write(string line)
        {
            _log.AppendText(line + Environment.NewLine);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }
    }
}