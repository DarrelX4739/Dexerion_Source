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
constexpr int kBack = 1, kForward = 2, kReload = 3, kGo = 4;

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
  fs::path profile;
  fs::path proof;
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

class Client final : public CefClient,
                     public CefLifeSpanHandler,
                     public CefDisplayHandler,
                     public CefLoadHandler {
 public:
  explicit Client(Options options) : options_(std::move(options)) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }

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
    fixture_loaded_ = status == 200 && frame->GetURL() == options_.url;
    MaybeFinish(browser);
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    if (!browser->IsPopup()) CefQuitMessageLoop();
  }

 private:
  void MaybeFinish(CefRefPtr<CefBrowser> browser) {
    if (options_.proof.empty() || finished_ || !fixture_loaded_ ||
        title_ != options_.expected_title) return;
    std::ofstream proof(options_.proof);
    proof << "CEF_RENDERED_FIXTURE\n" << title_.ToString() << '\n';
    proof.close();
    if (!proof) return;
    finished_ = true;
    browser->GetHost()->CloseBrowser(false);
  }

  const Options options_;
  CefString title_;
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
  Frame(CefRefPtr<CefBrowserView> view, CefString start)
      : view_(view), start_(std::move(start)) {}

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
    address_->SetText(start_);
    bar->AddChildView(address_);
    row->SetFlexForView(address_, 1);
    AddButton(bar, "Go", kGo);
    window->AddChildView(bar);
    window->AddChildView(view_);
    layout->SetFlexForView(view_, 1);
    window->Show();
  }

  bool CanClose(CefRefPtr<CefWindow>) override {
    auto browser = view_ ? view_->GetBrowser() : nullptr;
    return !browser || browser->GetHost()->TryCloseBrowser();
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow>) override {
    address_ = nullptr;
    view_ = nullptr;
  }

  void OnButtonPressed(CefRefPtr<CefButton> button) override {
    auto browser = view_ ? view_->GetBrowser() : nullptr;
    if (!browser) return;
    switch (button->GetID()) {
      case kBack: if (browser->CanGoBack()) browser->GoBack(); break;
      case kForward: if (browser->CanGoForward()) browser->GoForward(); break;
      case kReload: browser->Reload(); break;
      case kGo: Navigate(browser); break;
    }
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
    auto content = CefBrowserView::CreateBrowserView(new Client(options_), options_.url,
        settings, nullptr, nullptr, new ViewStyle());
    if (!content) { CefQuitMessageLoop(); return; }
    CefWindow::CreateTopLevelWindow(new Frame(content, options_.url));
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
