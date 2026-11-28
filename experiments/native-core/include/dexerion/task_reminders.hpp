#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace dexerion::task_reminders {

inline constexpr double kPreNotifyMs = 30 * 60 * 1000;
enum class Priority { high, medium, low };
enum class Reminder { none, pre, due };

// Already normalized, finite positive epoch milliseconds as produced by
// tasks.js's normalizeTask. Native ordering uses JavaScript's UTF-16 code units.
struct Task {
  std::u16string id;
  double due_ms{}, created_at_ms{};
  Priority priority{Priority::medium};
  bool done{}, reminded_pre{}, reminded_due{};
};

struct HeartbeatBudget {
  double fast_ms{}, slow_ms{};  // 0 uses the same JS defaults
  std::optional<double> near_window_ms;  // missing and zero are distinct in JS
};

Reminder reminder_kind(const Task& t, double now_ms) noexcept;
std::optional<double> next_reminder_at(const Task& t, double now_ms) noexcept;
std::vector<std::size_t> sort_tasks(const std::vector<Task>& tasks);
std::vector<std::size_t> next_three(const std::vector<Task>& tasks);
double heartbeat_ms(const std::vector<Task>& tasks, double now_ms, const HeartbeatBudget& b);

}  // namespace dexerion::task_reminders
