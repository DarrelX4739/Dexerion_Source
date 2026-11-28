#include "dexerion/adaptive_power.hpp"
#include <array>
#include <cstdint>
#include <cmath>
#include <cstdio>
// Fixed little-endian x64, two pre-agreed local processes; not a service.
namespace ap=dexerion::adaptive_power;
int main(){
 std::array<double,128*11> in{};std::array<double,128*8> out{};
 std::uint64_t n=0;
 while(std::fread(&n,sizeof(n),1,stdin)==1){
  if(n==0)return 0;
  if(n>128 || std::fread(in.data(),sizeof(double),11*n,stdin)!=11*n)return 2;
  for(std::size_t i=0;i<n;++i){
   const auto* a=in.data()+11*i;auto* o=out.data()+8*i;
   for(int j=0;j<11;j++)if(!std::isfinite(a[j]))return 2;
   if(a[0]<0||a[0]>1023||a[4]<0||a[4]>1e6||a[5]<0||a[5]>3)return 2;
   unsigned f=static_cast<unsigned>(a[0]);ap::Signals s;
   s.focused=f&1;s.minimized=f&2;s.locked=f&4;s.on_battery=f&8;s.video=f&16;s.webgl=f&32;
   s.animation=f&64;s.loading=f&128;s.audible=f&256;s.interacting=f&512;s.idle_ms=a[1];s.free_mem_mb=a[2];
   s.cpu_pct=a[3];s.active_tab_count=static_cast<int>(a[4]);
   const auto p=ap::runtime_plan(s,static_cast<ap::Tier>(static_cast<int>(a[5])),a[6],a[7],{a[8],a[9],a[10]});
   o[0]=static_cast<int>(p.gpu_tier);o[1]=p.sweep_interval_ms;o[2]=p.deep_idle_sweep;o[3]=p.idle_sleep_ms;
   o[4]=p.hide_inactive_views;o[5]=p.hide_minimized_views;o[6]=p.background_throttling;o[7]=p.sample_metrics;
  }
  if(std::fwrite(out.data(),sizeof(double),8*n,stdout)!=8*n||std::fflush(stdout)!=0)return 2;
 }
 return std::feof(stdin)?0:2;
}
