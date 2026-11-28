using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Setup
{
    [STAThread]
    private static int Main(string[] args)
    {
        var engine = new SetupEngine();
        bool previewFlag = args.Length == 1 && args[0] == "--preview";
        bool preview = previewFlag || !engine.HasPayload;
        if (args.Length > 0 && !previewFlag)
        {
            // Keep the raw NSIS command tail, including its unquoted, last /D= value.
            try { return engine.Forward(ArgumentTail(Environment.CommandLine)); }
            catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
        }
        bool first;
        using (var mutex = new Mutex(true, @"Local\Dexerion.BrandedSetup", out first))
        {
            if (!first) return 1;
            var app = new Application();
            return app.Run(new Wizard(engine, preview).Window);
        }
    }

    internal static string ArgumentTail(string commandLine)
    {
        var line = commandLine.TrimStart(' ', '\t');
        if (line.Length == 0) return "";
        int index = line[0] == '"' ? line.IndexOf('"', 1) + 1 : line.IndexOfAny(new[] { ' ', '\t' });
        return index > 0 ? line.Substring(index).TrimStart(' ', '\t') : "";
    }
}

internal sealed class Wizard
{
    private enum Stage { Welcome, Options, Browse, Installing, Ready, Error }
    private readonly SetupEngine engine;
    private readonly bool preview;
    private readonly Window window;
    private readonly StackPanel pages;
    private readonly Button primary, back, cancel, close, minimize;
    private readonly TextBlock[] steps;
    private readonly ScrollViewer scroller;
    private Stage stage;
    private bool allUsers;
    private string path, shownDefault, browsePath, installedExe;
    private TextBox location;
    private TextBlock status;
    private ListBox folders;
    private CheckBox launch;

    internal Window Window { get { return window; } }

    internal Wizard(SetupEngine engine, bool preview)
    {
        this.engine = engine;
        this.preview = preview;
        var assembly = typeof(Wizard).Assembly;
        using (var source = assembly.GetManifestResourceStream("Dexerion.SetupXaml"))
            window = (Window)XamlReader.Load(source);
        using (var source = assembly.GetManifestResourceStream("Dexerion.BrandLogo"))
        {
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = source;
            image.EndInit();
            image.Freeze();
            Element<Image>("Logo").Source = image;
            window.Icon = image;
        }
        window.Width = Math.Min(window.Width, SystemParameters.WorkArea.Width);
        window.Height = Math.Min(window.Height, SystemParameters.WorkArea.Height);
        pages = Element<StackPanel>("Pages");
        scroller = Element<ScrollViewer>("PageScroll");
        primary = Element<Button>("PrimaryButton");
        back = Element<Button>("BackButton");
        cancel = Element<Button>("CancelButton");
        close = Element<Button>("CloseButton");
        minimize = Element<Button>("MinimizeButton");
        steps = new[] { Element<TextBlock>("Step1"), Element<TextBlock>("Step2"), Element<TextBlock>("Step3"), Element<TextBlock>("Step4") };

        allUsers = engine.DefaultAllUsers;
        shownDefault = path = engine.Destination(allUsers);
        primary.Click += Advance;
        back.Click += delegate { GoBack(); };
        cancel.Click += delegate { window.Close(); };
        close.Click += delegate { window.Close(); };
        minimize.Click += delegate { window.WindowState = WindowState.Minimized; };
        window.Closing += delegate(object sender, CancelEventArgs e) { if (stage == Stage.Installing) e.Cancel = true; };
        window.PreviewKeyDown += delegate(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            if (stage == Stage.Browse) GoBack();
            else if (stage != Stage.Installing) window.Close();
        };
        Element<Border>("Titlebar").MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e)
        {
            if (e.ButtonState == MouseButtonState.Pressed) window.DragMove();
        };
        Show(Stage.Welcome);
    }

    private T Element<T>(string name) where T : class { return (T)window.FindName(name); }

    private Brush BrushFor(string name)
    {
        return (Brush)window.FindResource(name);
    }

    private TextBlock Text(string value, int size, string brush, bool bold)
    {
        return new TextBlock
        {
            Text = value, TextWrapping = TextWrapping.Wrap, FontSize = size,
            FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
            Foreground = BrushFor(brush), Margin = new Thickness(0, 0, 0, 9),
            LineHeight = Math.Max(size + 5, size * 1.25)
        };
    }

    private void Lead(string eyebrow, string title, string note)
    {
        pages.Children.Add(Text(eyebrow, 12, "Accent", true));
        pages.Children.Add(Text(title, 34, "Ink", true));
        pages.Children.Add(Text(note, 14, "Muted", false));
    }

    private void Show(Stage next)
    {
        stage = next;
        pages.Children.Clear();
        scroller.ScrollToTop();
        for (int i = 0; i < steps.Length; i++)
        {
            int current = next == Stage.Welcome ? 0 : next == Stage.Ready ? 3 : next == Stage.Installing ? 2 : 1;
            steps[i].Foreground = BrushFor(i == current ? "Accent" : "Muted");
            steps[i].FontWeight = i == current ? FontWeights.SemiBold : FontWeights.Normal;
        }
        primary.IsEnabled = true;
        primary.Visibility = next == Stage.Installing ? Visibility.Collapsed : Visibility.Visible;
        primary.IsDefault = next != Stage.Installing;
        back.Visibility = next == Stage.Options || next == Stage.Browse || next == Stage.Error
            ? Visibility.Visible : Visibility.Collapsed;
        close.IsEnabled = next != Stage.Installing;
        cancel.Visibility = next == Stage.Installing || next == Stage.Ready ? Visibility.Collapsed : Visibility.Visible;
        switch (next)
        {
            case Stage.Welcome:
                Lead(preview ? "DESIGN PREVIEW" : "01  /  WELCOME", "Make room for a better browser.",
                    preview ? "Walk through the new Dexerion Setup. This preview does not install anything."
                    : "Set up Dexerion on this computer. Your existing browser profile stays in place.");
                primary.Content = "_Continue";
                primary.Focus();
                break;
            case Stage.Options:
                Options();
                break;
            case Stage.Browse:
                Browse();
                break;
            case Stage.Installing:
                Lead(preview ? "DESIGN PREVIEW" : "03  /  INSTALLATION", "Setting up Dexerion",
                    "Keep this window open while Setup prepares your browser.");
                var indicator = new ProgressBar { Style = (Style)window.FindResource("InstallationProgress"), IsIndeterminate = true };
                AutomationProperties.SetName(indicator, "Installing Dexerion");
                pages.Children.Add(indicator);
                break;
            case Stage.Ready:
                Lead(preview ? "DESIGN PREVIEW" : "04  /  READY", "Dexerion is ready.",
                    preview ? "You reached the end of the preview. Nothing was installed or changed."
                    : "Installation is complete. Your Start menu and desktop shortcuts are ready.");
                launch = new CheckBox { Content = "_Launch Dexerion", IsChecked = true, Style = (Style)window.FindResource("Toggle") };
                pages.Children.Add(launch);
                primary.Content = "_Finish";
                primary.Focus();
                break;
            case Stage.Error:
                break;
        }
    }

    private Button SmallButton(string label)
    {
        return new Button { Content = label, Style = (Style)window.FindResource("Btn") };
    }

    private void ShowInstalledError(string message)
    {
        Show(Stage.Error);
        primary.Content = "_Back to options";
        Lead("SETUP NEEDS YOUR ATTENTION", "Installation could not be verified", message);
        primary.Focus();
    }

    private void Options()
    {
        Lead("02  /  INSTALL OPTIONS", "Choose your setup",
            "Choose who can use Dexerion on this PC and where to install it.");
        var scopeRow = new WrapPanel { Margin = new Thickness(0, 3, 0, 12) };
        RadioButton user = Choice("Just _me", !allUsers), machine = Choice("_Everyone on this PC", allUsers);
        machine.IsEnabled = engine.CanInstallForAll;
        scopeRow.Children.Add(user);
        scopeRow.Children.Add(machine);
        pages.Children.Add(scopeRow);

        var targetRow = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
        var browse = SmallButton("_Browse");
        browse.Margin = new Thickness(8, 0, 0, 0);
        DockPanel.SetDock(browse, Dock.Right);
        targetRow.Children.Add(browse);
        location = new TextBox { Text = path, Style = (Style)window.FindResource("TextEntry") };
        AutomationProperties.SetName(location, "Installation folder");
        targetRow.Children.Add(location);
        pages.Children.Add(Text("Installation folder", 13, "Ink", true));
        pages.Children.Add(targetRow);

        status = Text(allUsers ? "Windows may ask for administrator approval." : "No administrator approval is needed.", 13, "Muted", false);
        AutomationProperties.SetLiveSetting(status, AutomationLiveSetting.Polite);
        pages.Children.Add(status);
        user.Checked += delegate { SetScope(false); };
        machine.Checked += delegate { SetScope(true); };
        browse.Click += delegate
        {
            path = location.Text;
            browsePath = NearestFolder(path);
            Show(Stage.Browse);
        };
        primary.Content = preview ? "_Preview install" : "_Install Dexerion";
        primary.Focus();
    }

    private RadioButton Choice(string label, bool selected)
    {
        return new RadioButton
        {
            Content = label, IsChecked = selected, GroupName = "InstallScope",
            Margin = new Thickness(0, 0, 8, 0), Style = (Style)window.FindResource("Choice")
        };
    }

    private void SetScope(bool machine)
    {
        if (allUsers == machine) return;
        allUsers = machine;
        shownDefault = path = engine.Destination(machine);
        location.Text = path;
        status.Text = machine ? "Windows may ask for administrator approval." : "No administrator approval is needed.";
    }

    private static string NearestFolder(string input)
    {
        try
        {
            string current = Path.GetFullPath(input);
            while (!String.IsNullOrEmpty(current) && !Directory.Exists(current))
                current = Path.GetDirectoryName(current);
            if (!String.IsNullOrEmpty(current)) return current;
        }
        catch (Exception exception)
        {
            if (!(exception is ArgumentException || exception is IOException ||
                exception is NotSupportedException || exception is UnauthorizedAccessException)) throw;
        }
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    private void Browse()
    {
        Lead("02  /  INSTALL FOLDER", "Choose a folder",
            "Open a folder or go up one level. You can also type a full path in Install options.");
        var row = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        var up = SmallButton("_Up one level");
        up.Height = 34;
        DockPanel.SetDock(up, Dock.Right);
        row.Children.Add(up);
        row.Children.Add(Text(String.IsNullOrEmpty(browsePath) ? "This PC" : browsePath, 13, "Ink", true));
        pages.Children.Add(row);
        up.IsEnabled = !String.IsNullOrEmpty(browsePath);
        up.Click += delegate
        {
            var parent = Directory.GetParent(browsePath);
            browsePath = parent == null ? "" : parent.FullName;
            Show(Stage.Browse);
        };

        string[] targets;
        string failure = null;
        try
        {
            targets = String.IsNullOrEmpty(browsePath)
                ? DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => d.Name).ToArray()
                : Directory.GetDirectories(browsePath).OrderBy(p => p, StringComparer.CurrentCultureIgnoreCase).ToArray();
        }
        catch (Exception exception)
        {
            if (!(exception is IOException || exception is UnauthorizedAccessException)) throw;
            targets = new string[0];
            failure = "Setup could not list this folder.";
        }
        folders = new ListBox { Height = 120, BorderThickness = new Thickness(1), Background = BrushFor("Panel"),
            BorderBrush = BrushFor("Line"), Foreground = BrushFor("Ink") };
        AutomationProperties.SetName(folders, "Folders");
        foreach (var target in targets)
        {
            string label = Path.GetFileName(target.TrimEnd('\\'));
            var item = new ListBoxItem { Content = String.IsNullOrEmpty(label) || label.EndsWith(":") ? target : label,
                Tag = target, Style = (Style)window.FindResource("FolderItem") };
            folders.Items.Add(item);
        }
        folders.MouseDoubleClick += delegate { OpenSelected(); };
        folders.PreviewKeyDown += delegate(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) { e.Handled = true; OpenSelected(); }
        };
        pages.Children.Add(folders);
        if (failure != null) pages.Children.Add(Text(failure, 13, "Accent", false));
        primary.Content = "_Use this folder";
        primary.IsEnabled = !String.IsNullOrEmpty(browsePath);
        up.Focus();
    }

    private void OpenSelected()
    {
        var item = folders.SelectedItem as ListBoxItem;
        if (item == null) return;
        browsePath = (string)item.Tag;
        Show(Stage.Browse);
        folders.Focus();
    }

    private void GoBack()
    {
        if (stage == Stage.Options) { path = location.Text; Show(Stage.Welcome); }
        else if (stage == Stage.Browse || stage == Stage.Error) { primary.IsEnabled = true; Show(Stage.Options); }
    }

    private async void Advance(object sender, RoutedEventArgs e)
    {
        switch (stage)
        {
            case Stage.Welcome:
                Show(Stage.Options);
                return;
            case Stage.Browse:
                path = browsePath;
                primary.IsEnabled = true;
                Show(Stage.Options);
                return;
            case Stage.Ready:
                try
                {
                    if (!preview && launch.IsChecked == true)
                        Process.Start(new ProcessStartInfo(installedExe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(installedExe) });
                    window.Close();
                }
                catch (Exception exception)
                {
                    if (!(exception is IOException || exception is Win32Exception)) throw;
                    pages.Children.Add(Text("Dexerion is installed but couldn't be opened. Open it from the Start menu.", 13, "Accent", false));
                    launch.IsChecked = false;
                }
                return;
            case Stage.Error:
                Show(Stage.Options);
                return;
            case Stage.Options:
                break;
            default:
                return;
        }

        path = location.Text;
        string target;
        try
        {
            target = engine.NormalizeDestination(path, shownDefault);
            if (!preview && engine.AppIsRunning())
                throw new InvalidOperationException("Close all Dexerion windows, then try again.");
        }
        catch (Exception exception)
        {
            if (!(exception is ArgumentException || exception is IOException || exception is NotSupportedException ||
                exception is UnauthorizedAccessException || exception is InvalidOperationException)) throw;
            status.Text = exception.Message;
            return;
        }
        // Show the exact destination and let the user confirm if a parent path was expanded.
        if (!SetupEngine.SamePath(path, target))
        {
            location.Text = path = target;
            status.Text = "Dexerion will use the app folder shown above. Select Install again to confirm.";
            return;
        }
        Show(Stage.Installing);
        try
        {
            if (preview) await Task.Delay(650);
            else installedExe = await Task.Run(() => engine.Install(allUsers, target, shownDefault));
            Show(Stage.Ready);
        }
        catch (Exception exception)
        {
            ShowInstalledError(exception.Message);
        }
    }
}
