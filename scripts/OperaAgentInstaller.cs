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

        internal InstallerForm()
        {
            Text = "Opera Agent";
            ClientSize = new Size(560, 460);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F);

            var title = new Label
            {
                Text = "Pasang Opera Agent",
                Font = new Font("Segoe UI Semibold", 15F),
                AutoSize = true,
                Location = new Point(22, 20)
            };
            Controls.Add(title);

            var sub = new Label
            {
                Text = "Pilih browser yang mau memakai Opera Agent.",
                AutoSize = true,
                Location = new Point(22, 52),
                ForeColor = SystemColors.GrayText
            };
            Controls.Add(sub);

            Detect();

            int y = 86;
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
            foreach (var t in _targets)
            {
                var box = new CheckBox
                {
                    Text = t.Name,
                    Checked = true,
                    AutoSize = true,
                    Location = new Point(26, y),
                    Tag = t
                };
                box.CheckedChanged += (s, e) => ((BrowserTarget)((CheckBox)s).Tag).Selected = box.Checked;
                _boxes.Add(box);
                Controls.Add(box);
                y += 26;
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

            var cancel = new Button
            {
                Text = "Batal",
                Size = new Size(110, 38),
                Location = new Point(164, y)
            };
            cancel.Click += (s, e) => Close();
            Controls.Add(cancel);

            y += 52;
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.BackColor = Color.FromArgb(28, 30, 34);
            _log.ForeColor = Color.Gainsboro;
            _log.BorderStyle = BorderStyle.None;
            _log.Location = new Point(22, y);
            _log.Size = new Size(516, 108);
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

        private void Install()
        {
            _install.Enabled = false;
            _log.Clear();
            int ok = 0, failed = 0;

            foreach (var t in _targets.Where(x => x.Selected))
            {
                try
                {
                    using (var hive = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(t.PolicyKey, true)
                           ?? Microsoft.Win32.Registry.CurrentUser.CreateSubKey(t.PolicyKey))
                    using (var list = hive.CreateSubKey("ExtensionInstallForcelist"))
                    {
                        var existing = list.GetValue("ExtensionInstallForcelist") as string[];
                        var next = new List<string>();
                        if (existing != null)
                        {
                            // Replace our own entry instead of appending a duplicate
                            // on every run, so the list stays one line long.
                            foreach (var e in existing.Where(e => e != null && !e.Contains(ExtensionId)))
                                next.Add(e);
                        }
                        next.Add(FeedUrl);
                        list.SetValue("ExtensionInstallForcelist", next.ToArray(), RegistryValueKind.MultiString);
                    }
                    Write(t.Name + ": policy ditulis.");
                    ok++;
                }
                catch (Exception ex)
                {
                    Write(t.Name + ": gagal — " + ex.Message);
                    failed++;
                }
            }

            if (failed > 0)
            {
                Write("Sebagian gagal. Jalankan sebagai administrator.");
                _install.Enabled = true;
                return;
            }

            Write("Selesai. Tutup browser sepenuhnya, lalu buka lagi.");
            Write("Opera Agent terpasang saat browser mulai, dan memperbarui diri sendiri.");
            Write("Browser yang dipilih: " + ok);
            MessageBox.Show(
                "Opera Agent akan terpasang saat browser dibuka.\n\n"
                + "Tutup semua jendela browser sekarang, lalu buka lagi.",
                "Selesai", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void Write(string line)
        {
            _log.AppendText(line + Environment.NewLine);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }
    }
}