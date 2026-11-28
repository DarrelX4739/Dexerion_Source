#pragma once

#include <cmath>

namespace dexerion::detail {

// JS Math.round uses ties toward +infinity. floor(x + .5) is not equivalent:
// adding .5 can itself round a binary64 value onto the threshold. The fraction
// of a finite value below 2^52 can be tested directly; larger values are already
// integral. Preserve signed zero as JS does, even though our budgets rarely use it.
inline double js_round(double x) noexcept {
  if (!std::isfinite(x) || x == 0) return x;
  const double below = std::floor(x);
  const double value = x - below < 0.5 ? below : below + 1;
  return value == 0 ? std::copysign(0.0, x) : value;
}

}  // namespace dexerion::detail
