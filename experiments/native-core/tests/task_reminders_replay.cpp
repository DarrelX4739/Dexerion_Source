// Offline replay of normalized task records. ID tokens encode UTF-16 code units
// as hex to preserve JavaScript ordering, including supplementary characters.
#include "dexerion/task_reminders.hpp"

#include <cmath>
#include <iomanip>
#include <iostream>
#include <string>

namespace tr = dexerion::task_reminders;

static bool decode_id(const std::string& hex, std::u16string& id) {
  if (hex.empty() || hex.size() % 4 != 0 || hex.size() > 16384) return false;
  for (std::size_t i = 0; i < hex.size(); i += 4) {
    unsigned value = 0;
    for (std::size_t j = 0; j < 4; ++j) {
      const char c = hex[i+j];
      const int n = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
      if (n < 0) return false;
      value = value * 16 + static_cast<unsigned>(n);
    }
    id.push_back(static_cast<char16_t>(value));
  }
  return true;
}

static void indices(const std::vector<std::size_t>& values) {
  std::cout << '|';
  for (auto i : values) std::cout << ' ' << i;
}

int main() {
  int count, has_near;
  double now, near;
  tr::HeartbeatBudget b;
  std::cout << std::setprecision(17);
  std::string command;
  while (std::cin >> command) {
    if (command != "tasks" || !(std::cin >> count >> now >> b.fast_ms >> b.slow_ms >> has_near >> near) ||
        count < 0 || count > 10000 || (has_near != 0 && has_near != 1) || !std::isfinite(near) ||
        !std::isfinite(now) || now <= 0 || !std::isfinite(b.fast_ms) || !std::isfinite(b.slow_ms)) return 2;
    b.near_window_ms = has_near ? std::optional<double>(near) : std::nullopt;
    std::vector<tr::Task> rows(static_cast<std::size_t>(count));
    for (auto& t : rows) {
      std::string hex;
      int rank; unsigned flags;
      if (!(std::cin >> hex >> t.due_ms >> t.created_at_ms >> rank >> flags) ||
          rank < 0 || rank > 2 || flags > 7 || !std::isfinite(t.due_ms) ||
          t.due_ms < 1 || !std::isfinite(t.created_at_ms) || t.created_at_ms < 1 ||
          !decode_id(hex, t.id)) return 2;
      t.priority = static_cast<tr::Priority>(rank);
      t.done = flags & 1; t.reminded_pre = flags & 2; t.reminded_due = flags & 4;
    }
    std::cout << tr::heartbeat_ms(rows, now, b);
    indices(tr::sort_tasks(rows)); indices(tr::next_three(rows)); std::cout << '|';
    for (const auto& t : rows) {
      const auto next = tr::next_reminder_at(t, now);
      std::cout << ' ' << static_cast<int>(tr::reminder_kind(t, now)) << ':';
      if (next) std::cout << *next; else std::cout << '-';
    }
    std::cout << '\n';
  }
  return std::cin.eof() ? 0 : 2;
}
