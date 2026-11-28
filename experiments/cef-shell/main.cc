#include <charconv>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <system_error>
#include <utility>

#include "include/base/cef_compiler_specific.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_command_line.h"
#include "include/cef_display_handler.h"
#include "include/cef_frame.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"
#include "include/cef_parser.h"
#include "include/cef_task.h"
#include "include/views/cef_box_layout.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_button_delegate.h"
#include "include/views/cef_label_button.h"
#include "include/views/cef_panel.h"
#include "include/views/cef_textfield.h"
#include "include/views/cef_textfield_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"

#if defined(OS_WIN)
#include "include/cef_sandbox_win.h"
#include "include/cef_version_info.h"
#endif

namespace {
namespace fs = std::filesystem;

constexpr char kProfileMarker[] = ".dexerion-cef-experiment";
constexpr char kTitle[] = "Dexerion C++ experiment";
constexpr int kBack = 1, kForward = 2, kReload = 3, kGo = 4, kFocusLocation = 5;

std::string Utf8Path(const fs::path& path) {
  const auto bytes = path.u8string();
  return {bytes.begin(), bytes.end()};
}

bool WebAddress(const CefString& input) {
  if (input == "about:blank") return true;
  CefURLParts parts;
  if (!CefParseURL(input, parts)) return false;
  const CefString scheme(&parts.scheme);
  return (scheme == "http" || scheme == "https") &&
         !CefString(&parts.host).empty();
}

struct Options {
  CefString url = "about:blank";
  CefString expected_title;
  CefString expected_url;
  fs::path profile;
  fs::path proof;
  std::int64_t smoke_hold_ms = 0;
};

bool Status(const fs::path& path, fs::file_status& result) {
  std::error_code error;
  result = fs::symlink_status(path, error);
  return !error || error == std::errc::no_such_file_or_directory;
}

bool ParseOptions(CefRefPtr<CefCommandLine> arguments, Options& options) {
  if (!arguments->HasSwitch("spike-profile-dir")) return false;
  options.profile = fs::u8path(arguments->GetSwitchValue("spike-profile-dir").ToString()).lexically_normal();
  if (!options.profile.is_absolute() || options.profile == options.profile.root_path()) return false;
  fs::file_status directory;
  if (!Status(options.profile, directory) || fs::is_symlink(directory)) return false;
  const auto marker = options.profile / kProfileMarker;
  fs::file_status mark;
  if (!Status(marker, mark) || fs::is_symlink(mark)) return false;
  std::error_code error;
  if (fs::exists(directory)) {
    if (!fs::is_directory(directory)) return false;
    const bool empty = fs::is_empty(options.profile, error);
    if (error || (!empty && !fs::is_regular_file(mark))) return false;
  }
  if (arguments->HasSwitch("url"))
    options.url = arguments->GetSwitchValue("url");
  if (!WebAddress(options.url)) return false;
  if (arguments->HasSwitch("smoke-title")) {
    options.expected_title = arguments->GetSwitchValue("smoke-title");
    if (options.expected_title.empty() || !arguments->HasSwitch("smoke-proof")) return false;
    CefURLParts parts;
    if (!CefParseURL(options.url, parts) || CefString(&parts.scheme) != "http" ||
        CefString(&parts.host) != "127.0.0.1") return false;
    options.expected_url = arguments->HasSwitch("smoke-final-url")
        ? arguments->GetSwitchValue("smoke-final-url") : options.url;
    CefURLParts end;
    if (!CefParseURL(options.expected_url, end) ||
        CefString(&end.scheme) != CefString(&parts.scheme) ||
        CefString(&end.host) != CefString(&parts.host) ||
        CefString(&end.port) != CefString(&parts.port)) return false;
    if (arguments->HasSwitch("smoke-hold-ms")) {
      const auto text = arguments->GetSwitchValue("smoke-hold-ms").ToString();
      const auto end = text.data() + text.size();
      const auto result = std::from_chars(text.data(), end, options.smoke_hold_ms);
      if (result.ptr != end || result.ec != std::errc{} ||
          options.smoke_hold_ms < 0 || options.smoke_hold_ms > 120000) return false;
    }
    // Proof files can only be written inside the dedicated profile.
    const std::string proof = arguments->GetSwitchValue("smoke-proof").ToString();
    if (proof != "smoke-result.txt") return false;
    options.proof = options.profile / proof;
    fs::file_status file;
    if (!Status(options.proof, file) || fs::exists(file)) return false;
  }
  fs::create_directories(options.profile, error);
  if (error) return false;
  if (!fs::exists(mark)) {
    std::ofstream out(marker);
    out << "Dexerion CEF experiment profile, not an Electron profile.\n";
    if (!out) return false;
  }
  return true;
}

class CloseFixture final : public CefTask {
 public:
  explicit CloseFixture(CefRefPtr<CefBrowser> browser) : browser_(browser) {}
  void Execute() override {
    if (browser_ && browser_->IsValid()) browser_->GetHost()->CloseBrowser(false);
    browser_ = nullptr;
  }
 private:
  CefRefPtr<CefBrowser> browser_;
  IMPLEMENT_REFCOUNTING(CloseFixture);
};

class Client final : public CefClient,
                     public CefLifeSpanHandler,
                     public CefDisplayHandler,
                     public CefLoadHandler {
 public:
  explicit Client(Options options) : options_(std::move(options)) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }

  void SetAddressField(CefRefPtr<CefTextfield> field) {
    field_ = field;
    if (field_ && !committed_url_.empty()) field_->SetText(committed_url_);
  }

  void OnAddressChange(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                       const CefString& url) override {
    if (browser->IsPopup() || !frame || !frame->IsMain()) return;
    committed_url_ = url;
    if (field_ && !field_->HasFocus()) field_->SetText(committed_url_);
    MaybeFinish(browser);
  }

  // The spike has no multi-window/account popup policy yet.
  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int,
                     const CefString&, const CefString&, WindowOpenDisposition,
                     bool, const CefPopupFeatures&, CefWindowInfo&,
                     CefRefPtr<CefClient>&, CefBrowserSettings&,
                     CefRefPtr<CefDictionaryValue>&, bool*) override {
    return true;
  }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override {
    if (browser->IsPopup()) return;
    title_ = title;
    auto view = CefBrowserView::GetForBrowser(browser);
    if (view && view->GetWindow()) {
      view->GetWindow()->SetTitle(title.empty() ? CefString(kTitle) :
                                                  CefString(title.ToString() + " | " + kTitle));
    }
    MaybeFinish(browser);
  }

  void OnLoadEnd(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                 int status) override {
    if (browser->IsPopup() || !frame->IsMain()) return;
    fixture_loaded_ = status == 200 && frame->GetURL() == options_.expected_url;
    MaybeFinish(browser);
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    if (!browser->IsPopup()) { field_ = nullptr; CefQuitMessageLoop(); }
  }

 private:
  void MaybeFinish(CefRefPtr<CefBrowser> browser) {
    if (options_.proof.empty() || finished_ || !fixture_loaded_ ||
        title_ != options_.expected_title || committed_url_ != options_.expected_url ||
        !field_ || field_->GetText() != committed_url_) return;
    std::ofstream proof(options_.proof);
    proof << "CEF_RENDERED_FIXTURE\n" << title_.ToString() << '\n';
    proof.close();
    if (!proof) return;
    finished_ = true;
    if (options_.smoke_hold_ms > 0 &&
        CefPostDelayedTask(TID_UI, new CloseFixture(browser), options_.smoke_hold_ms)) return;
    browser->GetHost()->CloseBrowser(false);
  }

  const Options options_;
  CefString title_;
  CefString committed_url_;
  CefRefPtr<CefTextfield> field_;
  bool fixture_loaded_ = false;
  bool finished_ = false;
  IMPLEMENT_REFCOUNTING(Client);
};

class ViewStyle final : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
 private:
  IMPLEMENT_REFCOUNTING(ViewStyle);
};

class Frame final : public CefWindowDelegate,
                    public CefButtonDelegate,
                    public CefTextfieldDelegate {
 public:
  Frame(CefRefPtr<CefBrowserView> view, CefRefPtr<Client> client, CefString start)
      : view_(view), client_(client), start_(std::move(start)) {}

  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  CefSize GetPreferredSize(CefRefPtr<CefView>) override { return {1120, 760}; }

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->SetTitle(kTitle);
    CefBoxLayoutSettings vertical;
    auto layout = window->SetToBoxLayout(vertical);
    auto bar = CefPanel::CreatePanel(nullptr);
    CefBoxLayoutSettings horizontal;
    horizontal.horizontal = true;
    horizontal.between_child_spacing = 6;
    auto row = bar->SetToBoxLayout(horizontal);
    AddButton(bar, "Back", kBack);
    AddButton(bar, "Forward", kForward);
    AddButton(bar, "Reload", kReload);
    address_ = CefTextfield::CreateTextfield(this);
    address_->SetAccessibleName("Web address");
    address_->SetText(start_);
    client_->SetAddressField(address_);
    bar->AddChildView(address_);
    row->SetFlexForView(address_, 1);
    AddButton(bar, "Go", kGo);
    window->AddChildView(bar);
    window->AddChildView(view_);
    layout->SetFlexForView(view_, 1);
    window->SetAccelerator(kFocusLocation, 'L', false, true, false, true);
    window->SetAccelerator(kReload, 'R', false, true, false, true);
    window->SetAccelerator(kBack, 37, false, false, true, true);
    window->SetAccelerator(kForward, 39, false, false, true, true);
    window->Show();
    view_->RequestFocus();
  }

  bool CanClose(CefRefPtr<CefWindow>) override {
    auto browser = view_ ? view_->GetBrowser() : nullptr;
    return !browser || browser->GetHost()->TryCloseBrowser();
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow>) override {
    client_->SetAddressField(nullptr);
    address_ = nullptr;
    view_ = nullptr;
    client_ = nullptr;
  }

  bool OnAccelerator(CefRefPtr<CefWindow>, int command) override {
    if (command == kFocusLocation && address_) {
      address_->RequestFocus();
      address_->SelectAll(false);
      return true;
    }
    return BrowserCommand(command);
  }

  void OnButtonPressed(CefRefPtr<CefButton> button) override {
    BrowserCommand(button->GetID());
  }

  bool OnKeyEvent(CefRefPtr<CefTextfield>, const CefKeyEvent& event) override {
    if ((event.type != KEYEVENT_RAWKEYDOWN && event.type != KEYEVENT_KEYDOWN) ||
        event.windows_key_code != 13) return false;
    auto browser = view_ ? view_->GetBrowser() : nullptr;
    if (!browser) return false;
    Navigate(browser);
    return true;
  }

 private:
  bool BrowserCommand(int command) {
    auto browser = view_ ? view_->GetBrowser() : nullptr;
    if (!browser) return false;
    switch (command) {
      case kBack: if (browser->CanGoBack()) browser->GoBack(); return true;
      case kForward: if (browser->CanGoForward()) browser->GoForward(); return true;
      case kReload: browser->Reload(); return true;
      case kGo: Navigate(browser); return true;
      default: return false;
    }
  }

  void AddButton(CefRefPtr<CefPanel> bar, const char* label, int id) {
    auto button = CefLabelButton::CreateLabelButton(this, label);
    button->SetID(id);
    bar->AddChildView(button);
  }

  void Navigate(CefRefPtr<CefBrowser> browser) {
    const CefString location = address_->GetText();
    if (!WebAddress(location)) return;
    browser->GetMainFrame()->LoadURL(location);
    view_->RequestFocus();
  }

  CefRefPtr<CefBrowserView> view_;
  CefRefPtr<Client> client_;
  CefRefPtr<CefTextfield> address_;
  const CefString start_;
  IMPLEMENT_REFCOUNTING(Frame);
};

class App final : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit App(Options options) : options_(std::move(options)) {}
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnContextInitialized() override {
    CefBrowserSettings settings;
    CefRefPtr<Client> client = new Client(options_);
    auto content = CefBrowserView::CreateBrowserView(client, options_.url,
        settings, nullptr, nullptr, new ViewStyle());
    if (!content) { CefQuitMessageLoop(); return; }
    CefWindow::CreateTopLevelWindow(new Frame(content, client, options_.url));
  }
 private:
  const Options options_;
  IMPLEMENT_REFCOUNTING(App);
};

int BrowserMain(const CefMainArgs& args, CefRefPtr<CefCommandLine> command_line,
                void* sandbox) {
  Options options;
  if (!ParseOptions(command_line, options)) {
    std::cerr << "Provide an absolute new/dedicated --spike-profile-dir and a valid HTTP(S) URL.\n";
    return 2;
  }
  CefSettings settings;
  settings.no_sandbox = false;
  settings.command_line_args_disabled = true;
  CefString(&settings.root_cache_path) = Utf8Path(options.profile);
  CefString(&settings.cache_path) = Utf8Path(options.profile / "data");
  CefString(&settings.log_file) = Utf8Path(options.profile / "cef.log");
  CefRefPtr<CefApp> app = new App(options);
  if (!CefInitialize(args, settings, app, sandbox)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
}  // namespace

#if defined(OS_WIN)
CEF_BOOTSTRAP_EXPORT int RunWinMain(HINSTANCE instance, LPWSTR, int,
                                    void* sandbox, cef_version_info_t*) {
  if (!sandbox) return 3;
  const CefMainArgs args(instance);
  const int child = CefExecuteProcess(args, nullptr, sandbox);
  if (child >= 0) return child;
  auto command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromString(::GetCommandLineW());
  return BrowserMain(args, command_line, sandbox);
}
#else
NO_STACK_PROTECTOR int main(int argc, char** argv) {
  const CefMainArgs args(argc, argv);
  const int child = CefExecuteProcess(args, nullptr, nullptr);
  if (child >= 0) return child;
  auto command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromArgv(argc, argv);
  return BrowserMain(args, command_line, nullptr);
}
#endif
