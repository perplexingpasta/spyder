// Chrome/Edge omnibox reader (plan §9.2, ADR-0008). One JSON line per stdin request.
//   ping -> {"ok":true}
//   fg   -> {"ok":true,"hwnd":<int>,"value":"..."} | {"ok":false,"error":"..."}
// One-shot mode (P71): `UrlHelper.exe focus <hwnd>` brings that window to the front with keyboard
// focus, even while the user is typing in another app; exit code 0 when it worked.
// One-shot mode (P83): `UrlHelper.exe back <hwnd>` puts that window behind every other window.
// One-shot mode (P107, ADR-0012): `UrlHelper.exe desktop <hwnd>` makes Progman (the desktop) own that window,
// so Win+D leaves it showing, then puts it behind every other window. Exit 0 when owned, 1 when not, 2 when
// there is no Progman (it was only sent back).
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

static class UrlHelper
{
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr pid);
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")]
    static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

    static IntPtr cachedHwnd = IntPtr.Zero;
    static AutomationElement cachedEdit;

    static readonly Condition OmniboxCondition = new AndCondition(
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
        new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true));

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "focus") return Focus(new IntPtr(long.Parse(args[1])));
        if (args.Length == 2 && args[0] == "back") return Back(new IntPtr(long.Parse(args[1])));
        if (args.Length == 2 && args[0] == "desktop") return Desktop(new IntPtr(long.Parse(args[1])));
        var stdout = Console.Out;
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string cmd = line.Trim();
            string reply;
            if (cmd == "ping") reply = "{\"ok\":true}";
            else if (cmd == "fg") reply = Foreground();
            else if (cmd == "") continue;
            else reply = Err("unknown command");
            stdout.WriteLine(reply);
            stdout.Flush();
        }
        return 0;
    }

    /** Windows only lets the app that has the user's input take the foreground, so share its input for a moment. */
    static int Focus(IntPtr target)
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == target) return 0;
        uint me = GetCurrentThreadId();
        uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, IntPtr.Zero);
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        try
        {
            BringWindowToTop(target);
            SetForegroundWindow(target);
        }
        finally
        {
            if (attached) AttachThreadInput(me, fgThread, false);
        }
        return GetForegroundWindow() == target ? 0 : 1;
    }

    /** HWND_BOTTOM; SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE. */
    static int Back(IntPtr target)
    {
        return SetWindowPos(target, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010) ? 0 : 1;
    }

    /** GWLP_HWNDPARENT on a top-level window sets its owner; GW_OWNER reads it back. */
    static int Desktop(IntPtr target)
    {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) { Back(target); return 2; }
        if (GetWindow(target, 4) != progman) SetWindowLongPtr(target, -8, progman);
        Back(target);
        return GetWindow(target, 4) == progman ? 0 : 1;
    }

    static string Foreground()
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return Err("no foreground window");
            string value;
            try { value = Read(hwnd, false); }
            catch (ElementNotAvailableException) { value = Read(hwnd, true); }
            if (value == null) return Err("no omnibox");
            return "{\"ok\":true,\"hwnd\":" + hwnd.ToInt64() + ",\"value\":\"" + Esc(value) + "\"}";
        }
        catch (Exception e)
        {
            cachedHwnd = IntPtr.Zero;
            cachedEdit = null;
            return Err(e.GetType().Name + ": " + e.Message);
        }
    }

    static string Read(IntPtr hwnd, bool refind)
    {
        if (refind || hwnd != cachedHwnd || cachedEdit == null)
        {
            cachedHwnd = hwnd;
            cachedEdit = AutomationElement.FromHandle(hwnd).FindFirst(TreeScope.Descendants, OmniboxCondition);
            if (cachedEdit == null) { cachedHwnd = IntPtr.Zero; return null; }
        }
        var vp = (ValuePattern)cachedEdit.GetCurrentPattern(ValuePattern.Pattern);
        return vp.Current.Value ?? "";
    }

    static string Err(string msg)
    {
        return "{\"ok\":false,\"error\":\"" + Esc(msg) + "\"}";
    }

    static string Esc(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
