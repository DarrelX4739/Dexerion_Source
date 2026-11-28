#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace dexerion::memory_saver {

// Typed input boundary: the browser supplies normalized finite metrics and a
// single timestamp per sweep. No Electron handles, clocks or mutable tab state.
struct TabSnapshot {
  std::int64_t window_id{};
  std::string tab_id;
  std::string url;
  std::uint32_t pid{};  // 0 means "no process ID", not a shared process.
  double memory_mb{};
  double last_active_ms{};
  bool active{}, loading{}, lazy{}, sleeping{}, has_view{}, audible{};
};

inline constexpr double kIdleFloorMs = 60'000;
inline constexpr int kCapMinMb = 1024;
inline constexpr int kCapMaxMb = 4096;
inline constexpr int kCapDefaultMb = 1536;

struct SweepInput {
  double total_mb{};
  double cap_mb{};
  double now_ms{};
  double floor_ms{kIdleFloorMs};
};

struct SweepPlan {
  // Indices into the supplied snapshot, in the exact order to apply them.
  std::vector<std::size_t> victims;
  double projected_mb{};
  double over_mb{};
};

int clamp_cap_mb(double value) noexcept;
double hog_floor_mb(double cap_mb) noexcept;
bool should_notice_hog(double active_mb, double cap_mb, double over_mb) noexcept;
bool eligible(const TabSnapshot& tab, double now_ms, double floor_ms = kIdleFloorMs) noexcept;
SweepPlan plan_sweep(const std::vector<TabSnapshot>& tabs, const SweepInput& input);

}  // namespace dexerion::memory_saver
