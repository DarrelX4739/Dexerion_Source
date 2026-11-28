// Standalone CI benchmark only. All writes are to generated scratch paths.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <array>
#include <cstddef>
#include <cwchar>
#include <string>
#include <string_view>

namespace {
constexpr std::wstring_view prefix = L"HKCU\\Software\\DexerionPerformanceScratch\\";
constexpr std::wstring_view user_prefix = L"HKCU\\";
constexpr std::size_t total = 16;
using Pair = std::array<std::wstring_view, 2>;
constexpr std::array<Pair, total> plan{{
  {L"Classes\\DexerionHTML", L""},
  {L"Classes\\DexerionHTML\\DefaultIcon", L""},
  {L"Classes\\DexerionHTML\\shell\\open\\command", L""},
  {L"Clients\\StartMenuInternet\\Dexerion", L""},
  {L"Clients\\StartMenuInternet\\Dexerion\\DefaultIcon", L""},
  {L"Clients\\StartMenuInternet\\Dexerion\\shell\\open\\command", L""},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities", L"ApplicationName"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities", L"ApplicationDescription"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities", L"ApplicationIcon"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\URLAssociations", L"http"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\URLAssociations", L"https"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\FileAssociations", L".htm"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\FileAssociations", L".html"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\FileAssociations", L".xhtml"},
  {L"Clients\\StartMenuInternet\\Dexerion\\Capabilities\\StartMenu", L"StartMenuInternet"},
  {L"RegisteredApplications", L"Dexerion"}
}};
bool IsScratch(std::wstring_view value) {
  if (!value.starts_with(prefix) || value.size() != prefix.size() + 36) return false;
  value.remove_prefix(prefix.size());
  for (std::size_t i = 0; i != value.size(); ++i) {
    const wchar_t c = value[i];
    const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
    if (dash ? c != L'-' : !((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'))) return false;
  }
  return true;
}
}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc != 3 + static_cast<int>(total) * 3 || !IsScratch(argv[1])) return 2;
  const std::wstring_view mode(argv[2]);
  if (mode != L"write" && mode != L"stop-test" && mode != L"verify-only") return 2;
  // Validate the fixed command shape before creating anything.
  for (std::size_t i = 0; i < total; ++i) {
    const std::size_t arg = 3 + i * 3;
    if (std::wstring_view(argv[arg]) != plan[i][0] ||
        std::wstring_view(argv[arg + 1]) != plan[i][1] ||
        std::wcslen(argv[arg + 2]) > 2048) return 2;
  }
  const std::wstring root(argv[1] + user_prefix.size());
  for (std::size_t i = 0; i < total; ++i) {
    if (mode == L"stop-test" && i == 6) return 7;
    const std::size_t arg = 3 + i * 3;
    const std::wstring subkey(root + L"\\" + argv[arg]);
    HKEY handle = nullptr;
    if (mode == L"verify-only") {
      if (RegOpenKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, KEY_QUERY_VALUE, &handle) != ERROR_SUCCESS)
        return 8;
      std::array<wchar_t, 2049> value{};
      DWORD type = REG_NONE;
      DWORD bytes = static_cast<DWORD>(sizeof(value));
      const auto found = RegQueryValueExW(handle, argv[arg + 1], nullptr, &type,
          reinterpret_cast<BYTE*>(value.data()), &bytes);
      const auto closed = RegCloseKey(handle);
      const std::size_t chars = std::wcslen(argv[arg + 2]);
      if (found != ERROR_SUCCESS || closed != ERROR_SUCCESS || type != REG_SZ ||
          bytes != (chars + 1) * sizeof(wchar_t) || value[chars] != L'\0' ||
          std::wstring_view(value.data(), chars) != argv[arg + 2]) return 8;
      continue;
    }
    const auto made = RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr, &handle, nullptr);
    if (made != ERROR_SUCCESS) return 3;
    const auto* data = argv[arg + 2];
    const auto bytes = static_cast<DWORD>((std::wcslen(data) + 1) * sizeof(wchar_t));
    const auto written = RegSetValueExW(handle, argv[arg + 1], 0, REG_SZ,
        reinterpret_cast<const BYTE*>(data), bytes);
    const auto closed = RegCloseKey(handle);
    if (written != ERROR_SUCCESS || closed != ERROR_SUCCESS) return 4;
  }
  return 0;
}
