// WB2Window: runs a Director projector (Launcher.exe) inside a resizable,
// scaled window.
//
// The game's own window can't be resized, so we:
//  * show a live DWM thumbnail of it, scaled to fit our window;
//  * make the real game window invisible (alpha 1/255) and keep it just above
//    ours, shifting it on every mouse move so the game pixel that corresponds
//    to the cursor sits exactly under the cursor. Clicks, rollovers and the
//    game's cursors then work without faking any input.
//
// Build: csc /target:winexe /out:WB2Window.exe WB2Window.cs
// Usage: WB2Window.exe "path\to\Launcher.exe"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (args.Length < 1 || !File.Exists(args[0]))
        {
            MessageBox.Show("Usage: WB2Window.exe \"path\\to\\Launcher.exe\"", "WorldBuilder 2");
            return 1;
        }
        string exe = Path.GetFullPath(args[0]);
        var psi = new ProcessStartInfo(exe);
        psi.WorkingDirectory = Path.GetDirectoryName(exe);
        Process proc = Process.Start(psi);

        IntPtr game = Native.WaitForWindow(proc, 30000);
        if (game == IntPtr.Zero)
        {
            if (!proc.HasExited) MessageBox.Show("The game window did not appear.", "WorldBuilder 2");
            return 2;
        }
        Application.Run(new ScaledWindow(proc, game, exe));
        return 0;
    }
}

class ScaledWindow : Form
{
    readonly Process proc;
    IntPtr game;
    IntPtr thumb;
    Size native;
    Rectangle content;           // where the game is drawn, in client coordinates
    Point lastGamePos = new Point(int.MinValue, int.MinValue);
    bool inSizeMove;
    bool fullscreen;
    Rectangle restoreBounds;
    readonly Timer watch = new Timer();
    readonly Timer activateSoon = new Timer();
    IntPtr mouseHook, keyHook;
    Native.HookProc mouseProc, keyProc; // kept alive for the hooks

    public ScaledWindow(Process proc, IntPtr game, string exe)
    {
        this.proc = proc;
        this.game = game;
        native = Native.ClientSize(game);
        Text = "WorldBuilder 2";
        BackColor = Color.Black;
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(exe); } catch { }

        // Start at the largest whole-number scale that fits comfortably.
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        int scale = Math.Max(1, Math.Min((work.Width * 9 / 10) / native.Width, (work.Height * 9 / 10 - 40) / native.Height));
        ClientSize = new Size(native.Width * scale, native.Height * scale);
        MinimumSize = SizeFromClientSize(native);

        watch.Interval = 300;
        watch.Tick += delegate { Watch(); };
        activateSoon.Interval = 120;
        activateSoon.Tick += delegate { activateSoon.Stop(); if (!inSizeMove) ActivateGame(); };
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        AttachGame();
        mouseProc = MouseHook;
        keyProc = KeyHook;
        IntPtr mod = Native.GetModuleHandle(null);
        mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, mod, 0);
        keyHook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, mod, 0);
        watch.Start();
        ActivateGame();
    }

    void AttachGame()
    {
        native = Native.ClientSize(game);
        Native.ShowWindow(game, Native.SW_HIDE);
        int style = Native.GetWindowLong(game, Native.GWL_STYLE);
        style &= ~(Native.WS_CAPTION | Native.WS_THICKFRAME | Native.WS_SYSMENU | Native.WS_MINIMIZEBOX | Native.WS_MAXIMIZEBOX);
        Native.SetWindowLong(game, Native.GWL_STYLE, style);
        int ex = Native.GetWindowLong(game, Native.GWL_EXSTYLE);
        ex = (ex | Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW) & ~Native.WS_EX_APPWINDOW;
        Native.SetWindowLong(game, Native.GWL_EXSTYLE, ex);
        Native.SetLayeredWindowAttributes(game, 0, 1, Native.LWA_ALPHA);
        // Owned by us: always stays above our window, minimizes with it.
        Native.SetWindowLongPtr(game, Native.GWLP_HWNDPARENT, Handle);
        Native.SetWindowPos(game, IntPtr.Zero, 0, 0, native.Width, native.Height,
            Native.SWP_FRAMECHANGED | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_NOMOVE);
        Native.ShowWindow(game, Native.SW_SHOWNOACTIVATE);

        if (thumb != IntPtr.Zero) Native.DwmUnregisterThumbnail(thumb);
        Native.DwmRegisterThumbnail(Handle, game, out thumb);
        lastGamePos = new Point(int.MinValue, int.MinValue);
        UpdateLayout();
    }

    void UpdateLayout()
    {
        if (thumb == IntPtr.Zero || native.Width <= 0) return;
        Size c = ClientSize;
        double s = Math.Min((double)c.Width / native.Width, (double)c.Height / native.Height);
        int w = (int)Math.Round(native.Width * s), h = (int)Math.Round(native.Height * s);
        content = new Rectangle((c.Width - w) / 2, (c.Height - h) / 2, w, h);

        // Explicit source rect: DWM's "client area only" option keeps using the
        // old title-bar offset after we strip the game window's frame.
        Point origin = Native.ClientOffset(game);
        var props = new Native.DWM_THUMBNAIL_PROPERTIES();
        props.dwFlags = Native.DWM_TNP_RECTDESTINATION | Native.DWM_TNP_RECTSOURCE | Native.DWM_TNP_VISIBLE | Native.DWM_TNP_OPACITY;
        props.rcDestination = new Native.RECT(content.Left, content.Top, content.Right, content.Bottom);
        props.rcSource = new Native.RECT(origin.X, origin.Y, origin.X + native.Width, origin.Y + native.Height);
        props.opacity = 255;
        props.fVisible = true;
        Native.DwmUpdateThumbnailProperties(thumb, ref props);
        PlaceGame(Cursor.Position);
    }

    // Shift the invisible game window so the game pixel under the cursor is the
    // one shown there in our scaled view.
    void PlaceGame(Point pt)
    {
        if (content.Width <= 0) return;
        Rectangle screen = RectangleToScreen(content);
        int gx = screen.X, gy = screen.Y;
        if (screen.Contains(pt))
        {
            int px = Math.Min(native.Width - 1, (int)((pt.X - screen.X) * (double)native.Width / screen.Width));
            int py = Math.Min(native.Height - 1, (int)((pt.Y - screen.Y) * (double)native.Height / screen.Height));
            gx = pt.X - px;
            gy = pt.Y - py;
        }
        if (gx == lastGamePos.X && gy == lastGamePos.Y) return;
        lastGamePos = new Point(gx, gy);
        Native.SetWindowPos(game, IntPtr.Zero, gx, gy, 0, 0,
            Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_ASYNCWINDOWPOS);
    }

    IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && WindowState != FormWindowState.Minimized)
        {
            var info = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
            PlaceGame(new Point(info.x, info.y));
        }
        return Native.CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    IntPtr KeyHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && (int)wParam == Native.WM_KEYDOWN)
        {
            int vk = Marshal.ReadInt32(lParam);
            IntPtr fg = Native.GetForegroundWindow();
            if (vk == Native.VK_F11 && (fg == game || fg == Handle))
            {
                BeginInvoke(new Action(ToggleFullscreen));
                return (IntPtr)1;
            }
        }
        return Native.CallNextHookEx(keyHook, code, wParam, lParam);
    }

    void ToggleFullscreen()
    {
        if (!fullscreen)
        {
            restoreBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromHandle(Handle).Bounds;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = restoreBounds;
        }
        fullscreen = !fullscreen;
        UpdateLayout();
        ActivateGame();
    }

    void ActivateGame()
    {
        if (Native.IsWindow(game)) Native.SetForegroundWindow(game);
    }

    void Watch()
    {
        if (proc.HasExited) { Close(); return; }
        if (!Native.IsWindow(game))
        {
            // The projector recreated its stage window; pick up the new one.
            IntPtr w = Native.FindWindow(proc);
            if (w != IntPtr.Zero) { game = w; AttachGame(); }
            return;
        }
        Size now = Native.ClientSize(game);
        if (now != native && now.Width > 0 && now.Height > 0)
        {
            native = now;
            MinimumSize = SizeFromClientSize(native);
            UpdateLayout();
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        UpdateLayout();
    }

    protected override void OnMove(EventArgs e)
    {
        base.OnMove(e);
        lastGamePos = new Point(int.MinValue, int.MinValue);
        PlaceGame(Cursor.Position);
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case Native.WM_ACTIVATE:
                // Keep the game active so it keeps running and gets the keyboard.
                if (((int)m.WParam & 0xFFFF) != 0) { activateSoon.Stop(); activateSoon.Start(); }
                break;
            case Native.WM_ENTERSIZEMOVE:
                inSizeMove = true;
                break;
            case Native.WM_EXITSIZEMOVE:
                inSizeMove = false;
                ActivateGame();
                break;
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        watch.Stop();
        if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
        if (keyHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyHook);
        if (thumb != IntPtr.Zero) Native.DwmUnregisterThumbnail(thumb);
        if (!proc.HasExited)
        {
            Native.PostMessage(game, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            if (!proc.WaitForExit(2000)) { try { proc.Kill(); } catch { } }
        }
        base.OnFormClosing(e);
    }
}

static class Native
{
    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
    public const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000,
        WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
    public const int WS_EX_LAYERED = 0x00080000, WS_EX_TOOLWINDOW = 0x00000080, WS_EX_APPWINDOW = 0x00040000;
    public const int LWA_ALPHA = 2;
    public const int SW_HIDE = 0, SW_SHOWNOACTIVATE = 4;
    public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10,
        SWP_FRAMECHANGED = 0x20, SWP_ASYNCWINDOWPOS = 0x4000;
    public const int WH_MOUSE_LL = 14, WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, VK_F11 = 0x7A;
    public const int WM_ACTIVATE = 0x6, WM_CLOSE = 0x10, WM_ENTERSIZEMOVE = 0x231, WM_EXITSIZEMOVE = 0x232;
    public const int DWM_TNP_RECTDESTINATION = 0x1, DWM_TNP_RECTSOURCE = 0x2, DWM_TNP_OPACITY = 0x4, DWM_TNP_VISIBLE = 0x8;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
        public RECT(int l, int t, int r, int b) { Left = l; Top = t; Right = r; Bottom = b; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DWM_THUMBNAIL_PROPERTIES
    {
        public int dwFlags;
        public RECT rcDestination;
        public RECT rcSource;
        public byte opacity;
        [MarshalAs(UnmanagedType.Bool)] public bool fVisible;
        [MarshalAs(UnmanagedType.Bool)] public bool fSourceClientAreaOnly;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT { public int x, y; public int mouseData, flags, time; public IntPtr extra; }

    public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr64(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] static extern IntPtr SetWindowLong32(IntPtr h, int i, IntPtr v);
    public static IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v) { return IntPtr.Size == 8 ? SetWindowLongPtr64(h, i, v) : SetWindowLong32(h, i, v); }
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, int flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
    [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr dest, IntPtr src, out IntPtr thumb);
    [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumb);
    [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref DWM_THUMBNAIL_PROPERTIES props);

    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    // Position of the client area inside the window.
    public static Point ClientOffset(IntPtr h)
    {
        RECT r;
        GetWindowRect(h, out r);
        var p = new POINT();
        ClientToScreen(h, ref p);
        return new Point(p.X - r.Left, p.Y - r.Top);
    }

    public static Size ClientSize(IntPtr h)
    {
        RECT r;
        GetClientRect(h, out r);
        return new Size(r.Right - r.Left, r.Bottom - r.Top);
    }

    // The process's largest visible top-level window (the Director stage).
    public static IntPtr FindWindow(Process proc)
    {
        IntPtr best = IntPtr.Zero;
        int bestArea = 0;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == proc.Id && IsWindowVisible(h))
            {
                Size s = ClientSize(h);
                int area = s.Width * s.Height;
                if (s.Width >= 200 && s.Height >= 150 && area > bestArea) { best = h; bestArea = area; }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    // Wait until the stage window exists and its size has settled.
    public static IntPtr WaitForWindow(Process proc, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        IntPtr last = IntPtr.Zero;
        Size lastSize = Size.Empty;
        int stable = 0;
        while (sw.ElapsedMilliseconds < timeoutMs && !proc.HasExited)
        {
            IntPtr h = FindWindow(proc);
            Size s = h == IntPtr.Zero ? Size.Empty : ClientSize(h);
            if (h != IntPtr.Zero && h == last && s == lastSize) { if (++stable >= 3) return h; }
            else stable = 0;
            last = h;
            lastSize = s;
            System.Threading.Thread.Sleep(150);
        }
        return IntPtr.Zero;
    }
}
