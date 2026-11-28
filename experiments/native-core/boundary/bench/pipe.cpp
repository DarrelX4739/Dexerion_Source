#include "dexerion/adaptive_power.hpp"
#include <iomanip>
#include <iostream>
#include <string>
namespace ap=dexerion::adaptive_power;
int main(){
 std::ios::sync_with_stdio(false);std::cin.tie(nullptr);
 std::cout<<std::setprecision(17);
 std::string op;
 while(std::cin >> op){
  if(op=="quit")return 0;
  unsigned count=0;
  if(op!="batch"||!(std::cin>>count)||count<1||count>4096)return 2;
  for(unsigned i=0;i<count;++i){
   unsigned f; int prev;
   ap::Signals s;ap::Budgets b;double now,since;
   if(!(std::cin>>f>>s.idle_ms>>s.free_mem_mb>>s.cpu_pct>>s.active_tab_count>>prev>>now>>since
        >>b.sweep_interval_ms>>b.idle_sleep_ms>>b.sweep_deep_idle_ms)||f>1023||prev<0||prev>3)return 2;
   s.focused=f&1;s.minimized=f&2;s.locked=f&4;s.on_battery=f&8;s.video=f&16;s.webgl=f&32;
   s.animation=f&64;s.loading=f&128;s.audible=f&256;s.interacting=f&512;
   auto p=ap::runtime_plan(s,static_cast<ap::Tier>(prev),now,since,b);
   if(i)std::cout<<';';
   std::cout<<static_cast<int>(p.gpu_tier)<<','<<p.sweep_interval_ms<<','<<p.deep_idle_sweep<<','
      <<p.idle_sleep_ms<<','<<p.hide_inactive_views<<','<<p.hide_minimized_views<<','
      <<p.background_throttling<<','<<p.sample_metrics;
  }
  std::cout<<'\n'<<std::flush;
 }
}
