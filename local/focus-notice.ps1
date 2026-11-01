# @last-edited: 2026-11-01 UTC+7.
# @title: focus-notice - the question asked in the corner of the window the person is working in.
# @state: one panel that follows the window in front, stays above it, counts down, and gives the answer on stdout; a host mode that answers every question from one process.

param(
  [int]$TimeoutSec = 30,
  [switch]$Worker
)

# WHY THE QUESTION ARRIVES OVER STDIN AND NOT AS AN ARGUMENT.
# Measured on this machine: a window title handed from one PowerShell to another as an argument arrived as `bring A` - every quote and every word after it was gone, because PowerShell rewrites the arguments of a native program before it hands them over.
# A pipe carries the text as it is, so the person is told what is about to happen to their screen.
# When there is no pipe - a person running this by hand - the panel still opens and says nothing more than the default.

$What = ''
if ((-not $Worker) -and [Console]::IsInputRedirected) {
  $What = [Console]::In.ReadToEnd().Trim()
}
if ($What -eq '') {
  $What = 'bring the browser window forward'
}

# WHY THE PANEL SITS OVER THE WINDOW IN FRONT AND NOT OVER THE CHAT.
# The person is working somewhere else - another tab, another browser, another program - and a question asked in the chat is a question they only find when they come back.
# So the question is asked where their eyes already are, in the corner of that window, and it never takes the focus: the panel is shown without being activated, so the keys they are typing keep going to the same place.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# WHY THE CLASS IS COMPILED ONCE PER PROCESS AND NOT ONCE PER QUESTION.
# The panel host answers every question from one process, so the class is compiled when the process starts and the loop below only makes new forms.

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class NotchWindow : Form {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public string Answer = "DISMISS";

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);

    // WHY THE PANEL IS MARKED AS A WINDOW THAT NEVER TAKES THE FOCUS.
    // Measured on this machine: the panel opened and the window the person was working in stopped being the window in front - their keystrokes went to the panel instead of to their page.
    // A window with WS_EX_NOACTIVATE cannot become the window in front, so the person keeps typing where they were typing while the question sits over their work.

    SetWindowLong(this.Handle, -20, GetWindowLong(this.Handle, -20) | 0x08000000);
  }

  // WHY THE PANEL FOLLOWS THE PERSON AND STAYS ABOVE IT.
  // Measured on this machine: the panel opened over the window the person was in, and the moment they clicked another program that program covered the panel - the question was there, but under the work, and nobody saw it.
  // So the panel moves to the corner of whatever is in front and is put above it again, like a notch on a phone that cannot be covered by the app in front of it.

  public void Follow() {
    IntPtr front = GetForegroundWindow();
    if (front == IntPtr.Zero || front == this.Handle) return;
    Rectangle area = Screen.FromHandle(front).WorkingArea;
    RECT r;
    GetWindowRect(front, out r);
    int x = r.Right - this.Width - 20;
    int y = r.Top + 20;
    if (x < area.Left) x = area.Left + 20;
    if (x + this.Width > area.Right) x = area.Right - this.Width - 20;
    if (y + this.Height > area.Bottom) y = area.Bottom - this.Height - 20;
    this.Location = new Point(x, y);
    SetWindowPos(this.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0013);
  }

  public NotchWindow() {
    this.FormBorderStyle = FormBorderStyle.None;
    this.ShowInTaskbar = false;
    this.TopMost = true;
    this.StartPosition = FormStartPosition.Manual;
    this.BackColor = Color.FromArgb(24, 24, 27);
    this.Size = new Size(460, 140);
  }

  protected override bool ShowWithoutActivation { get { return true; } }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0021) {
      m.Result = (IntPtr)3;
      return;
    }
    base.WndProc(ref m);
  }
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

# WHY THE PANEL IS A FUNCTION AND NOT THE SCRIPT BODY.
# A host that waits for the next question has to come back to its loop, so the panel is a thing that is shown, answered, and handed back.

function Show-OperaNotice {
  param(
    [string]$Question,
    [int]$Seconds
  )

  $form = New-Object NotchWindow
  $form.Text = 'Opera Agent focus notice'

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Opera Agent wants to change what is on your screen'
  $title.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 240)
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $title.SetBounds(18, 14, 424, 22)
  $form.Controls.Add($title)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Question
  $label.ForeColor = [System.Drawing.Color]::FromArgb(170, 170, 180)
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $label.SetBounds(18, 40, 424, 34)
  $form.Controls.Add($label)

  # WHY THE PANEL COUNTS DOWN TO THE MOMENT THE SCREEN GOES.
  # The person is sometimes away from the machine, and a drive that waits on a question nobody is there to answer never finishes.
  # So the panel says when the screen goes, and at that moment it lets the drive on - a person who is there can still say no before then, and then the screen stays theirs.

  $deadline = New-Object System.Windows.Forms.Label
  $deadline.Text = 'No answer in ' + $Seconds + ' second(s) and the drive takes the screen.'
  $deadline.ForeColor = [System.Drawing.Color]::FromArgb(120, 120, 130)
  $deadline.Font = New-Object System.Drawing.Font('Segoe UI', 8)
  $deadline.SetBounds(18, 74, 424, 20)
  $form.Controls.Add($deadline)

  $allow = New-Object System.Windows.Forms.Button
  $allow.Text = 'Allow'
  $allow.FlatStyle = 'Flat'
  $allow.ForeColor = [System.Drawing.Color]::FromArgb(20, 20, 24)
  $allow.BackColor = [System.Drawing.Color]::FromArgb(120, 200, 140)
  $allow.SetBounds(18, 100, 110, 28)
  $allow.Add_Click({
    $form.Answer = 'ALLOW'
    $form.Close()
  })
  $form.Controls.Add($allow)

  $dismiss = New-Object System.Windows.Forms.Button
  $dismiss.Text = 'Dismiss'
  $dismiss.FlatStyle = 'Flat'
  $dismiss.ForeColor = [System.Drawing.Color]::FromArgb(225, 225, 230)
  $dismiss.BackColor = [System.Drawing.Color]::FromArgb(58, 58, 64)
  $dismiss.SetBounds(140, 100, 110, 28)
  $dismiss.Add_Click({
    $form.Answer = 'DISMISS'
    $form.Close()
  })
  $form.Controls.Add($dismiss)

  $form.Show()
  $form.Follow()

  $until = [DateTime]::Now.AddSeconds($Seconds)

  $follow = New-Object System.Windows.Forms.Timer
  $follow.Interval = 500
  $follow.Add_Tick({
    $form.Follow()
    $left = [Math]::Max(0, [Math]::Ceiling(($until - [DateTime]::Now).TotalSeconds))
    $deadline.Text = 'No answer in ' + $left + ' second(s) and the drive takes the screen.'
  })
  $follow.Start()

  # WHY THE DEADLINE ANSWERS YES AND NOT NO.
  # The person who is away is not a person who said no, and a drive that treats silence as a refusal never finishes on a machine nobody is sitting at.
  # The panel says when the screen goes, and at that moment the screen goes.

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = [Math]::Max(1000, $Seconds * 1000)
  $timer.Add_Tick({
    $timer.Stop()
    $follow.Stop()
    $form.Answer = 'ALLOW'
    $form.Close()
  })

  $timer.Start()
  [System.Windows.Forms.Application]::Run($form)
  return $form.Answer
}

# WHY THE HOST READS ONE QUESTION AT A TIME.
# The panel sits in the corner of the window the person is in, and two questions at once would ask for two different things at the same time.

if ($Worker) {
  # WHY THE HOST SAYS IT IS READY.
  # The agent waits for that word before it asks anything, so the question never arrives while the panel class is still being compiled and the person never sees a panel that was too late.

  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()

  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $request = $null
    try {
      $request = $line | ConvertFrom-Json
    } catch {
      continue
    }
    $question = [string]$request.what
    $seconds = $TimeoutSec
    if ($request.seconds) { $seconds = [int]$request.seconds }
    $answer = Show-OperaNotice $question $seconds

    # WHY THE ANSWER GOES OUT THROUGH THE CONSOLE AND NOT THE PIPELINE.
    # Measured live on this machine: a line written through the PowerShell pipeline came back 1.1 s later, and the same line written to the console and flushed came back in under ten milliseconds.

    [Console]::Out.WriteLine($answer)
    [Console]::Out.Flush()
  }
  exit 0
}

Write-Output (Show-OperaNotice $What $TimeoutSec)
