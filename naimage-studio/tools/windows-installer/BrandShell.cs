using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;

namespace Naimage.WindowsInstaller;

internal static class BrandPalette
{
    internal static readonly Color Ink = Color.FromRgb(58, 42, 22);
    internal static readonly Color Panel = Color.FromRgb(255, 249, 232);
    internal static readonly Color Card = Color.FromRgb(255, 242, 201);
    internal static readonly Color CardHover = Color.FromRgb(255, 233, 168);
    internal static readonly Color Line = Color.FromRgb(229, 197, 107);
    internal static readonly Color Muted = Color.FromRgb(125, 105, 65);
    internal static readonly Color Text = Color.FromRgb(58, 42, 22);
    internal static readonly Color Mint = Color.FromRgb(244, 189, 36);
    internal static readonly Color Blue = Color.FromRgb(217, 119, 50);
    internal static readonly Color Danger = Color.FromRgb(201, 79, 68);
    internal static readonly Color Success = Color.FromRgb(104, 132, 70);

    internal static SolidColorBrush Brush(Color color) => new(color);
}

internal sealed class BrandToggle : ToggleButton
{
    private readonly Border _surface;
    private readonly Border _indicator;
    private readonly TextBlock _check;

    internal BrandToggle(string caption, bool initialValue = true)
    {
        Focusable = true;
        IsTabStop = true;
        IsThreeState = false;
        Cursor = Cursors.Hand;
        Background = Brushes.Transparent;
        BorderThickness = new Thickness(0);
        Padding = new Thickness(0);
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        FocusVisualStyle = null;
        Template = CreateToggleTemplate();
        AutomationProperties.SetName(this, caption);
        AutomationProperties.SetHelpText(this, "按空格键切换此选项");

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        _indicator = new Border
        {
            Width = 20,
            Height = 20,
            CornerRadius = new CornerRadius(6),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(0, 0, 11, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        _check = new TextBlock
        {
            Text = "✓",
            FontSize = 13,
            FontWeight = FontWeights.Bold,
            Foreground = BrandPalette.Brush(BrandPalette.Ink),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        _indicator.Child = _check;

        var captionText = new TextBlock
        {
            Text = caption,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = BrandPalette.Brush(BrandPalette.Text),
            VerticalAlignment = VerticalAlignment.Center
        };

        Grid.SetColumn(_indicator, 0);
        Grid.SetColumn(captionText, 1);
        row.Children.Add(_indicator);
        row.Children.Add(captionText);
        _surface = new Border
        {
            CornerRadius = new CornerRadius(10),
            BorderThickness = new Thickness(1),
            BorderBrush = BrandPalette.Brush(BrandPalette.Line),
            Background = BrandPalette.Brush(BrandPalette.Card),
            Padding = new Thickness(13, 11, 13, 11),
            Child = row
        };
        Content = _surface;

        Checked += (_, _) => UpdateIndicator();
        Unchecked += (_, _) => UpdateIndicator();
        MouseEnter += (_, _) => _surface.Background = BrandPalette.Brush(BrandPalette.CardHover);
        MouseLeave += (_, _) => _surface.Background = BrandPalette.Brush(BrandPalette.Card);
        GotKeyboardFocus += (_, _) => _surface.BorderBrush = BrandPalette.Brush(BrandPalette.Mint);
        LostKeyboardFocus += (_, _) => _surface.BorderBrush = BrandPalette.Brush(BrandPalette.Line);
        IsChecked = initialValue;
    }

    internal new bool IsChecked
    {
        get => base.IsChecked == true;
        set
        {
            base.IsChecked = value;
            UpdateIndicator();
        }
    }

    private void UpdateIndicator()
    {
        var value = base.IsChecked == true;
        _indicator.Background = value ? BrandPalette.Brush(BrandPalette.Mint) : Brushes.Transparent;
        _indicator.BorderBrush = value ? BrandPalette.Brush(BrandPalette.Mint) : BrandPalette.Brush(BrandPalette.Muted);
        _check.Visibility = value ? Visibility.Visible : Visibility.Hidden;
    }

    internal AutomationPeer CreateAutomationPeerForDiagnostics() => OnCreateAutomationPeer();

    private static ControlTemplate CreateToggleTemplate()
    {
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Stretch);
        presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Stretch);
        return new ControlTemplate(typeof(ToggleButton)) { VisualTree = presenter };
    }
}

internal enum BrandButtonTone
{
    Secondary,
    Primary,
    Danger
}

internal sealed class BrandButtonColors
{
    internal BrandButtonColors(Color normal, Color hover, Color foreground, Color border)
    {
        Normal = normal;
        Hover = hover;
        Foreground = foreground;
        Border = border;
    }

    internal Color Normal { get; }
    internal Color Hover { get; }
    internal Color Foreground { get; }
    internal Color Border { get; }
}

internal static class BrandWindowSizing
{
    internal const double DesignWidth = 920;
    internal const double DesignHeight = 620;
    private const double WorkAreaMargin = 32;

    internal static Size FitToWorkArea()
    {
        var workArea = SystemParameters.WorkArea;
        var diagnostic = Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_WORKAREA");
        if (!string.IsNullOrWhiteSpace(diagnostic))
        {
            var parts = diagnostic!.Split(new[] { 'x', 'X', '×' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 2 &&
                double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var width) &&
                double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var height) &&
                width > 0 && height > 0)
            {
                workArea = new Rect(0, 0, width, height);
            }
        }

        var availableWidth = Math.Max(DesignWidth * 0.5, workArea.Width - WorkAreaMargin);
        var availableHeight = Math.Max(DesignHeight * 0.5, workArea.Height - WorkAreaMargin);
        var scale = Math.Min(1, Math.Min(availableWidth / DesignWidth, availableHeight / DesignHeight));
        scale = Math.Max(0.5, scale);
        return new Size(Math.Floor(DesignWidth * scale), Math.Floor(DesignHeight * scale));
    }
}

internal class BrandWindow : Window
{
    private readonly Border _windowBorder;
    private readonly TextBlock _stepText;
    private readonly TextBlock _titleText;
    private readonly TextBlock _descriptionText;
    private readonly ContentControl _contentHost;
    private readonly Button _closeButton;

    internal Button BackButton { get; }
    internal Button SecondaryButton { get; }
    internal Button PrimaryButton { get; }
    internal Button CloseButton => _closeButton;
    internal TextBlock FooterNote { get; }

    internal BrandWindow(string windowTitle, string edition)
    {
        var fittedSize = BrandWindowSizing.FitToWorkArea();
        Title = windowTitle;
        Width = fittedSize.Width;
        Height = fittedSize.Height;
        MinWidth = fittedSize.Width;
        MinHeight = fittedSize.Height;
        MaxWidth = fittedSize.Width;
        MaxHeight = fittedSize.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
        SnapsToDevicePixels = true;
        UseLayoutRounding = true;

        _windowBorder = new Border
        {
            Width = BrandWindowSizing.DesignWidth,
            Height = BrandWindowSizing.DesignHeight,
            CornerRadius = new CornerRadius(22),
            BorderThickness = new Thickness(1),
            BorderBrush = BrandPalette.Brush(BrandPalette.Line),
            Background = BrandPalette.Brush(BrandPalette.Panel),
            Effect = new DropShadowEffect
            {
                BlurRadius = 36,
                Direction = 270,
                ShadowDepth = 10,
                Opacity = 0.48,
                Color = Colors.Black
            }
        };

        var root = new Grid();
        root.Clip = new RectangleGeometry(
            new Rect(0, 0, BrandWindowSizing.DesignWidth, BrandWindowSizing.DesignHeight),
            22,
            22);
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(302) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        root.Children.Add(CreateHero(edition));

        var right = new Grid { Background = BrandPalette.Brush(BrandPalette.Panel) };
        right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(56) });
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(82) });
        Grid.SetColumn(right, 1);
        root.Children.Add(right);

        var titleBar = new Grid { Background = Brushes.Transparent };
        titleBar.MouseLeftButtonDown += (_, e) =>
        {
            if (e.ChangedButton == MouseButton.Left) DragMove();
        };
        titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var caption = new TextBlock
        {
            Text = windowTitle,
            Margin = new Thickness(28, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = BrandPalette.Brush(BrandPalette.Muted),
            FontSize = 12,
            FontWeight = FontWeights.SemiBold
        };
        _closeButton = MakeButton("×", false, compact: true);
        _closeButton.Width = 38;
        _closeButton.Height = 34;
        _closeButton.Margin = new Thickness(0, 10, 12, 8);
        _closeButton.FontSize = 21;
        AutomationProperties.SetName(_closeButton, "关闭窗口");
        AutomationProperties.SetHelpText(_closeButton, $"关闭 {windowTitle}");
        _closeButton.Click += (_, _) => Close();
        Grid.SetColumn(caption, 0);
        Grid.SetColumn(_closeButton, 1);
        titleBar.Children.Add(caption);
        titleBar.Children.Add(_closeButton);
        right.Children.Add(titleBar);

        var heading = new StackPanel { Margin = new Thickness(34, 10, 34, 0) };
        _stepText = new TextBlock
        {
            Foreground = BrandPalette.Brush(BrandPalette.Mint),
            FontSize = 11,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(0, 0, 0, 8)
        };
        _titleText = new TextBlock
        {
            Foreground = BrandPalette.Brush(BrandPalette.Text),
            FontSize = 27,
            FontWeight = FontWeights.SemiBold,
            LineHeight = 35
        };
        _descriptionText = new TextBlock
        {
            Foreground = BrandPalette.Brush(BrandPalette.Muted),
            FontSize = 13,
            LineHeight = 21,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0)
        };
        heading.Children.Add(_stepText);
        heading.Children.Add(_titleText);
        heading.Children.Add(_descriptionText);
        Grid.SetRow(heading, 1);
        right.Children.Add(heading);

        _contentHost = new ContentControl { Margin = new Thickness(34, 22, 34, 14) };
        Grid.SetRow(_contentHost, 2);
        right.Children.Add(_contentHost);

        var footer = new Grid
        {
            Margin = new Thickness(34, 12, 34, 20),
            VerticalAlignment = VerticalAlignment.Bottom
        };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        BackButton = MakeButton("返回", false);
        SecondaryButton = MakeButton("取消", false);
        PrimaryButton = MakeButton("继续", true);
        SecondaryButton.Margin = new Thickness(0, 0, 10, 0);
        FooterNote = new TextBlock
        {
            Foreground = BrandPalette.Brush(BrandPalette.Muted),
            FontSize = 10.5,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(14, 0, 16, 0),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        Grid.SetColumn(BackButton, 0);
        Grid.SetColumn(FooterNote, 1);
        Grid.SetColumn(SecondaryButton, 2);
        Grid.SetColumn(PrimaryButton, 3);
        footer.Children.Add(BackButton);
        footer.Children.Add(FooterNote);
        footer.Children.Add(SecondaryButton);
        footer.Children.Add(PrimaryButton);
        Grid.SetRow(footer, 3);
        right.Children.Add(footer);

        _windowBorder.Child = root;
        Content = new Viewbox
        {
            Stretch = Stretch.Uniform,
            StretchDirection = StretchDirection.DownOnly,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Child = _windowBorder
        };
    }

    internal bool CloseEnabled
    {
        get => _closeButton.IsEnabled;
        set
        {
            _closeButton.IsEnabled = value;
            _closeButton.Opacity = value ? 1 : 0.35;
        }
    }

    internal void SetKeyboardButtons(Button? defaultButton, Button? cancelButton)
    {
        foreach (var button in new[] { BackButton, SecondaryButton, PrimaryButton })
        {
            button.IsDefault = ReferenceEquals(button, defaultButton);
            button.IsCancel = ReferenceEquals(button, cancelButton);
        }
    }

    internal void SetPage(string step, string title, string description, UIElement content)
    {
        _stepText.Text = step.ToUpperInvariant();
        _titleText.Text = title;
        _descriptionText.Text = description;
        _contentHost.Content = content;
    }

    internal static Button MakeButton(string text, bool primary, bool compact = false)
    {
        var button = new Button
        {
            Content = text,
            Height = compact ? 34 : 42,
            MinWidth = compact ? 38 : 98,
            Padding = compact ? new Thickness(8, 0, 8, 0) : new Thickness(18, 0, 18, 0),
            BorderThickness = new Thickness(1),
            FontSize = compact ? 12 : 13,
            FontWeight = FontWeights.SemiBold,
            Cursor = Cursors.Hand,
            FocusVisualStyle = null,
            Template = CreateButtonTemplate()
        };
        SetButtonLabel(button, text);
        SetButtonTone(button, primary ? BrandButtonTone.Primary : BrandButtonTone.Secondary);
        button.MouseEnter += (_, _) => button.Background = BrandPalette.Brush(((BrandButtonColors)button.Tag).Hover);
        button.MouseLeave += (_, _) => button.Background = BrandPalette.Brush(((BrandButtonColors)button.Tag).Normal);
        button.GotKeyboardFocus += (_, _) => button.BorderBrush = BrandPalette.Brush(BrandPalette.Blue);
        button.LostKeyboardFocus += (_, _) => button.BorderBrush = BrandPalette.Brush(((BrandButtonColors)button.Tag).Border);
        button.IsEnabledChanged += (_, _) =>
        {
            button.Opacity = button.IsEnabled ? 1 : 0.42;
            button.Cursor = button.IsEnabled ? Cursors.Hand : Cursors.Arrow;
        };
        button.PreviewMouseLeftButtonDown += (_, _) =>
        {
            if (button.IsEnabled) button.Opacity = 0.82;
        };
        button.PreviewMouseLeftButtonUp += (_, _) =>
        {
            if (button.IsEnabled) button.Opacity = 1;
        };
        button.MouseLeave += (_, _) =>
        {
            if (button.IsEnabled) button.Opacity = 1;
        };
        return button;
    }

    internal static void SetButtonLabel(Button button, string text)
    {
        button.Content = text;
        AutomationProperties.SetName(button, text);
    }

    internal static void SetButtonTone(Button button, BrandButtonTone tone)
    {
        var colors = tone switch
        {
            BrandButtonTone.Primary => new BrandButtonColors(
                BrandPalette.Mint,
                Color.FromRgb(255, 213, 83),
                BrandPalette.Ink,
                BrandPalette.Mint),
            BrandButtonTone.Danger => new BrandButtonColors(
                BrandPalette.Danger,
                Color.FromRgb(220, 105, 93),
                Colors.White,
                BrandPalette.Danger),
            _ => new BrandButtonColors(
                BrandPalette.Card,
                BrandPalette.CardHover,
                BrandPalette.Text,
                BrandPalette.Line)
        };
        button.Tag = colors;
        button.Background = BrandPalette.Brush(colors.Normal);
        button.Foreground = BrandPalette.Brush(colors.Foreground);
        button.BorderBrush = BrandPalette.Brush(colors.Border);
    }

    private static ControlTemplate CreateButtonTemplate()
    {
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
        border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        border.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        border.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        presenter.SetBinding(ContentPresenter.MarginProperty, new System.Windows.Data.Binding("Padding")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        border.AppendChild(presenter);
        return new ControlTemplate(typeof(Button)) { VisualTree = border };
    }

    internal static Border Card(UIElement child, Thickness? padding = null)
    {
        return new Border
        {
            CornerRadius = new CornerRadius(13),
            BorderThickness = new Thickness(1),
            BorderBrush = BrandPalette.Brush(BrandPalette.Line),
            Background = BrandPalette.Brush(BrandPalette.Card),
            Padding = padding ?? new Thickness(16),
            Child = child
        };
    }

    internal static TextBlock Text(string value, double size = 13, Color? color = null, FontWeight? weight = null)
    {
        return new TextBlock
        {
            Text = value,
            FontSize = size,
            Foreground = BrandPalette.Brush(color ?? BrandPalette.Text),
            FontWeight = weight ?? FontWeights.Normal,
            TextWrapping = TextWrapping.Wrap,
            LineHeight = size + 7
        };
    }

    internal static Border StatusPill(string value, Color? accent = null)
    {
        var color = accent ?? BrandPalette.Mint;
        return new Border
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = BrandPalette.Brush(Color.FromArgb(34, color.R, color.G, color.B)),
            BorderBrush = BrandPalette.Brush(Color.FromArgb(110, color.R, color.G, color.B)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(999),
            Padding = new Thickness(10, 5, 10, 5),
            Child = Text(value, 10.5, color, FontWeights.SemiBold)
        };
    }

    internal static ProgressBar MakeProgressBar()
    {
        var bar = new ProgressBar
        {
            Height = 8,
            Minimum = 0,
            Maximum = 100,
            Background = BrandPalette.Brush(Color.FromRgb(241, 223, 167)),
            Foreground = BrandPalette.Brush(BrandPalette.Mint),
            BorderThickness = new Thickness(0)
        };
        return bar;
    }

    internal static ScrollViewer MakeScrollArea(UIElement content, double height, string automationName)
    {
        var viewer = new ScrollViewer
        {
            Content = content,
            Height = height,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            PanningMode = PanningMode.VerticalOnly,
            CanContentScroll = false,
            Focusable = true,
            IsTabStop = true
        };
        AutomationProperties.SetName(viewer, automationName);
        AutomationProperties.SetHelpText(viewer, "使用鼠标滚轮、方向键或 Page Up / Page Down 查看全部内容");
        viewer.PreviewMouseWheel += (_, e) =>
        {
            viewer.ScrollToVerticalOffset(Math.Max(0, viewer.VerticalOffset - Math.Sign(e.Delta) * 56));
            e.Handled = true;
        };
        viewer.PreviewKeyDown += (_, e) =>
        {
            var offset = viewer.VerticalOffset;
            if (e.Key == Key.Down) offset += 36;
            else if (e.Key == Key.Up) offset -= 36;
            else if (e.Key == Key.PageDown) offset += Math.Max(72, height - 24);
            else if (e.Key == Key.PageUp) offset -= Math.Max(72, height - 24);
            else return;
            viewer.ScrollToVerticalOffset(Math.Max(0, offset));
            e.Handled = true;
        };
        return viewer;
    }

    internal static void DetachFromLogicalParent(UIElement element)
    {
        var parent = LogicalTreeHelper.GetParent(element);
        switch (parent)
        {
            case Panel panel:
                panel.Children.Remove(element);
                break;
            case Decorator decorator when ReferenceEquals(decorator.Child, element):
                decorator.Child = null;
                break;
            case ContentControl contentControl when ReferenceEquals(contentControl.Content, element):
                contentControl.Content = null;
                break;
        }
    }

    private UIElement CreateHero(string edition)
    {
        var hero = new Grid
        {
            Background = new LinearGradientBrush(
                Color.FromRgb(255, 250, 225),
                Color.FromRgb(246, 207, 91),
                new Point(0, 0),
                new Point(1, 1))
        };
        hero.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        hero.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        hero.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var glow = new System.Windows.Shapes.Ellipse
        {
            Width = 330,
            Height = 330,
            Fill = new RadialGradientBrush(
                Color.FromArgb(88, BrandPalette.Mint.R, BrandPalette.Mint.G, BrandPalette.Mint.B),
                Color.FromArgb(0, BrandPalette.Mint.R, BrandPalette.Mint.G, BrandPalette.Mint.B)),
            Margin = new Thickness(110, -170, -140, 0),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            IsHitTestVisible = false
        };
        Grid.SetRowSpan(glow, 3);
        hero.Children.Add(glow);

        var brand = new StackPanel { Margin = new Thickness(28, 30, 28, 0) };
        var logoRow = new StackPanel { Orientation = Orientation.Horizontal };
        var logo = new Image
        {
            Source = LoadLogo(),
            Width = 52,
            Height = 52,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 13, 0)
        };
        var brandText = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        brandText.Children.Add(Text("naimage", 22, BrandPalette.Text, FontWeights.Bold));
        brandText.Children.Add(Text("STUDIO", 9, BrandPalette.Mint, FontWeights.Bold));
        logoRow.Children.Add(logo);
        logoRow.Children.Add(brandText);
        brand.Children.Add(logoRow);
        brand.Children.Add(StatusPill(edition));
        ((FrameworkElement)brand.Children[1]).Margin = new Thickness(0, 18, 0, 0);
        hero.Children.Add(brand);

        var message = new StackPanel
        {
            Margin = new Thickness(28, 0, 30, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        message.Children.Add(Text("一键翻译，\n多国语言套图。", 28, BrandPalette.Text, FontWeights.SemiBold));
        var line = new Border
        {
            Width = 72,
            Height = 3,
            Background = new LinearGradientBrush(BrandPalette.Mint, BrandPalette.Blue, 0),
            CornerRadius = new CornerRadius(2),
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 20, 0, 20)
        };
        message.Children.Add(line);
        message.Children.Add(Text("专属个性配置 · 跨境电商套图\n批量生图 · 参考图编辑 · 分层交付", 12.5, BrandPalette.Muted));
        Grid.SetRow(message, 1);
        hero.Children.Add(message);

        var foot = new StackPanel { Margin = new Thickness(28, 0, 28, 28) };
        foot.Children.Add(Text("SparkAI Workspace", 9, BrandPalette.Blue, FontWeights.Bold));
        foot.Children.Add(Text("Windows 10 / 11 · x64", 10.5, BrandPalette.Muted));
        Grid.SetRow(foot, 2);
        hero.Children.Add(foot);
        return hero;
    }

    private static ImageSource? LoadLogo()
    {
        try
        {
            return new BitmapImage(new Uri("pack://application:,,,/naimage.png", UriKind.Absolute));
        }
        catch
        {
            return null;
        }
    }
}

internal static class BrandCapture
{
    internal static bool TryCapture(Window window, string[] args)
    {
        var capture = ArgumentValue(args, "--capture");
        if (string.IsNullOrWhiteSpace(capture)) return false;
        var scaleText = ArgumentValue(args, "--capture-scale");
        var scale = double.TryParse(scaleText, out var parsed) ? Math.Max(1, Math.Min(2.5, parsed)) : 1;
        var destination = Path.GetFullPath(capture);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        window.WindowStartupLocation = WindowStartupLocation.Manual;
        window.Left = -12000;
        window.Top = -12000;
        window.ShowInTaskbar = false;
        window.Show();
        window.Dispatcher.Invoke(() => { }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
        window.UpdateLayout();

        var width = Math.Max(1, (int)Math.Ceiling(window.ActualWidth * scale));
        var height = Math.Max(1, (int)Math.Ceiling(window.ActualHeight * scale));
        var bitmap = new RenderTargetBitmap(width, height, 96 * scale, 96 * scale, PixelFormats.Pbgra32);
        bitmap.Render(window);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var output = File.Create(destination);
        encoder.Save(output);
        window.Close();
        return true;
    }

    internal static string? ArgumentValue(string[] args, string name)
    {
        for (var index = 0; index < args.Length; index++)
        {
            var current = args[index];
            if (current.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
            {
                return current.Substring(name.Length + 1).Trim('"');
            }
            if (string.Equals(current, name, StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
            {
                return args[index + 1].Trim('"');
            }
        }
        return null;
    }
}

internal static class WindowsCommandLine
{
    internal static string Join(params string[] arguments)
    {
        return string.Join(" ", Array.ConvertAll(arguments, Quote));
    }

    internal static string Quote(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return argument;
        var result = new System.Text.StringBuilder(argument.Length + 4);
        result.Append('"');
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}

internal static class ProcessWatchdog
{
    private const string DiagnosticOverrideGate = "NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_TIMEOUT_OVERRIDE";

    internal static TimeSpan ResolveTimeout(string environmentName, TimeSpan fallback)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable(DiagnosticOverrideGate), "1", StringComparison.Ordinal))
            return fallback;
        var raw = Environment.GetEnvironmentVariable(environmentName);
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var milliseconds) &&
               milliseconds >= 1 && milliseconds <= 3_600_000
            ? TimeSpan.FromMilliseconds(milliseconds)
            : fallback;
    }

    internal static async Task<bool> WaitForExitAsync(
        Process process,
        TimeSpan timeout,
        TimeSpan pollInterval,
        CancellationToken cancellationToken,
        Action? heartbeat = null)
    {
        var elapsed = Stopwatch.StartNew();
        var pollMilliseconds = Math.Max(10, (int)Math.Ceiling(pollInterval.TotalMilliseconds));
        while (!process.HasExited)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                TryTerminateTree(process);
                cancellationToken.ThrowIfCancellationRequested();
            }
            if (elapsed.Elapsed >= timeout)
            {
                TryTerminateTree(process);
                return false;
            }

            var remainingMilliseconds = Math.Max(1, (int)Math.Ceiling((timeout - elapsed.Elapsed).TotalMilliseconds));
            try
            {
                await Task.Delay(Math.Min(pollMilliseconds, remainingMilliseconds), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                TryTerminateTree(process);
                throw;
            }
            heartbeat?.Invoke();
        }
        return true;
    }

    internal static void TryTerminateTree(Process process)
    {
        try { if (process.HasExited) return; }
        catch { return; }

        try
        {
            using var taskkill = Process.Start(new ProcessStartInfo("taskkill.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = WindowsCommandLine.Join("/PID", process.Id.ToString(CultureInfo.InvariantCulture), "/T", "/F")
            });
            taskkill?.WaitForExit(10_000);
        }
        catch { }

        try { if (!process.HasExited) process.Kill(); }
        catch { }
        try { process.WaitForExit(10_000); }
        catch { }
    }
}

internal static class BrandOperationLock
{
    internal const string OperationTokenEnvironmentName = "NAIMAGE_INSTALLER_OPERATION_TOKEN";

    private static readonly string LockRoot = Path.Combine(
        Path.GetTempPath(),
        "naimage-studio-installer",
        "operation-lock");

    private static string LockPath => Path.Combine(LockRoot, "install-uninstall.lock");

    internal static bool TryAcquire(out IDisposable? lease)
    {
        return TryAcquire(out lease, out _);
    }

    internal static bool TryAcquire(out IDisposable? lease, out string operationToken)
    {
        lease = null;
        operationToken = "";
        try
        {
            Directory.CreateDirectory(LockRoot);
            var token = Guid.NewGuid().ToString("N");
            var stream = new FileStream(
                LockPath,
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.Read | FileShare.Delete,
                128,
                FileOptions.DeleteOnClose);
            try
            {
                var marker = System.Text.Encoding.UTF8.GetBytes(
                    $"token={token}\npid={Process.GetCurrentProcess().Id}\nstarted={DateTimeOffset.UtcNow:O}\n");
                stream.SetLength(0);
                stream.Write(marker, 0, marker.Length);
                stream.Flush(true);
                operationToken = token;
                lease = stream;
                return true;
            }
            catch
            {
                stream.Dispose();
                throw;
            }
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    internal static bool TryJoinInherited(out IDisposable? lease)
    {
        lease = null;
        var inheritedToken = Environment.GetEnvironmentVariable(
            OperationTokenEnvironmentName,
            EnvironmentVariableTarget.Process);
        if (!IsValidToken(inheritedToken)) return false;

        try
        {
            using var stream = new FileStream(
                LockPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                256,
                FileOptions.SequentialScan);
            using var reader = new StreamReader(stream, System.Text.Encoding.UTF8, true, 256);
            var marker = reader.ReadToEnd();
            var ownerToken = marker
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Where(line => line.StartsWith("token=", StringComparison.Ordinal))
                .Select(line => line.Substring("token=".Length))
                .FirstOrDefault();
            if (!FixedTimeEquals(inheritedToken!, ownerToken)) return false;
            lease = JoinedOperationLease.Instance;
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    internal static void AttachOperationToken(ProcessStartInfo startInfo, string operationToken)
    {
        if (!IsValidToken(operationToken)) return;
        startInfo.EnvironmentVariables[OperationTokenEnvironmentName] = operationToken;
    }

    private static bool IsValidToken(string? token)
    {
        return !string.IsNullOrWhiteSpace(token) &&
               token!.Length == 32 &&
               Guid.TryParseExact(token, "N", out _);
    }

    private static bool FixedTimeEquals(string left, string? right)
    {
        if (right is null || left.Length != right.Length) return false;
        var difference = 0;
        for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
        return difference == 0;
    }

    private sealed class JoinedOperationLease : IDisposable
    {
        internal static readonly JoinedOperationLease Instance = new();
        public void Dispose() { }
    }
}

internal static class PathAccess
{
    internal static bool RequiresElevation(string destination)
    {
        var candidate = Path.GetFullPath(destination);
        while (!Directory.Exists(candidate))
        {
            var parent = Path.GetDirectoryName(candidate);
            if (string.IsNullOrWhiteSpace(parent) || string.Equals(parent, candidate, StringComparison.OrdinalIgnoreCase)) break;
            candidate = parent;
        }
        if (!Directory.Exists(candidate)) return true;
        var probe = Path.Combine(candidate, ".naimage-write-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
            return false;
        }
        catch (UnauthorizedAccessException) { return true; }
        catch (System.Security.SecurityException) { return true; }
        catch (IOException) { return true; }
        finally
        {
            try { if (File.Exists(probe)) File.Delete(probe); } catch { }
        }
    }
}

internal static class NativeMethods
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);

    internal static void EnablePerMonitorDpi()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch { /* WPF still uses its manifest-level DPI behavior. */ }
    }
}
