#include <node_api.h>
#include "dexerion/adaptive_power.hpp"

#include <cmath>
#include <cstddef>
#include <optional>
#include <string_view>

namespace ap = dexerion::adaptive_power;
// Laboratory adapter. It never links into the browser or talks to a renderer.
static bool num(napi_env e, napi_value o, const char* k, double& d) {
  napi_value v;
  return napi_get_named_property(e,o,k,&v)==napi_ok && napi_get_value_double(e,v,&d)==napi_ok && std::isfinite(d);
}
static bool yes(napi_env e, napi_value o, const char* k, bool& b) {
  napi_value v;
  return napi_get_named_property(e,o,k,&v)==napi_ok && napi_get_value_bool(e,v,&b)==napi_ok;
}
static bool set_num(napi_env e,napi_value o,const char* k,double d) {
  napi_value v; return napi_create_double(e,d,&v)==napi_ok && napi_set_named_property(e,o,k,v)==napi_ok;
}
static bool set_bool(napi_env e,napi_value o,const char* k,bool b) {
  napi_value v; return napi_get_boolean(e,b,&v)==napi_ok && napi_set_named_property(e,o,k,v)==napi_ok;
}
static napi_value error(napi_env e) {
  napi_throw_type_error(e,nullptr,"Expected normalized test policy input"); return nullptr;
}
static napi_value object_call(napi_env e,napi_callback_info info) {
  napi_value args[5]; size_t n=5;
  if(napi_get_cb_info(e,info,&n,args,nullptr,nullptr)!=napi_ok || n!=5) return error(e);
  auto in=args[0];
  ap::Signals s;
  if(!yes(e,in,"focused",s.focused)||!yes(e,in,"minimized",s.minimized)||!yes(e,in,"locked",s.locked)||
     !yes(e,in,"onBattery",s.on_battery)||!yes(e,in,"video",s.video)||!yes(e,in,"webgl",s.webgl)||
     !yes(e,in,"animation",s.animation)||!yes(e,in,"loading",s.loading)||!yes(e,in,"audible",s.audible)||
     !yes(e,in,"interacting",s.interacting)||!num(e,in,"idleMs",s.idle_ms)||!num(e,in,"freeMemMB",s.free_mem_mb)||
     !num(e,in,"cpuPct",s.cpu_pct)) return error(e);
  double tabs=0,now=0,since=0;
  if(!num(e,in,"activeTabCount",tabs) || tabs<0 || tabs>1e6 || std::floor(tabs)!=tabs ||
     napi_get_value_double(e,args[2],&now)!=napi_ok || !std::isfinite(now) ||
     !num(e,args[3],"tierSince",since)) return error(e);
  s.active_tab_count=static_cast<int>(tabs);
  char buf[24];size_t len=0;
  if(napi_get_value_string_utf8(e,args[1],buf,sizeof(buf),&len)!=napi_ok) return error(e);
  const auto prev=ap::tier_from_name(std::string_view(buf,len));
  ap::Budgets b;
  if(!num(e,args[4],"sweepIntervalMs",b.sweep_interval_ms)||!num(e,args[4],"idleSleepMs",b.idle_sleep_ms)||
     !num(e,args[4],"sweepDeepIdleMs",b.sweep_deep_idle_ms)) return error(e);
  const auto p=ap::runtime_plan(s,prev,now,since,b);
  napi_value o,t;
  auto tier=ap::name(p.gpu_tier);
  if(napi_create_object(e,&o)!=napi_ok || napi_create_string_utf8(e,tier.data(),tier.size(),&t)!=napi_ok ||
     napi_set_named_property(e,o,"gpuTier",t)!=napi_ok || !set_num(e,o,"sweepIntervalMs",p.sweep_interval_ms)||
     !set_bool(e,o,"deepIdleSweep",p.deep_idle_sweep)||!set_num(e,o,"idleSleepMs",p.idle_sleep_ms)||
     !set_bool(e,o,"hideInactiveViews",p.hide_inactive_views)||!set_bool(e,o,"hideMinimizedViews",p.hide_minimized_views)||
     !set_bool(e,o,"backgroundThrottling",p.background_throttling)||!set_bool(e,o,"sampleMetrics",p.sample_metrics)) return error(e);
  return o;
}
static napi_value packed_call(napi_env e,napi_callback_info info) {
  napi_value arg; size_t n=1,len=0,offset=0; napi_typedarray_type type; void* ptr=nullptr; napi_value buffer;
  if(napi_get_cb_info(e,info,&n,&arg,nullptr,nullptr)!=napi_ok || n!=1 ||
     napi_get_typedarray_info(e,arg,&type,&len,&ptr,&buffer,&offset)!=napi_ok || type!=napi_float64_array ||
     len!=19 || !ptr) return error(e);
  auto* a=static_cast<double*>(ptr);
  for(unsigned i=0;i<11;++i) if(!std::isfinite(a[i])) return error(e);
  if(a[0]<0||a[0]>1023||a[4]<0||a[4]>1e6||a[5]<0||a[5]>3) return error(e);
  const unsigned flags=static_cast<unsigned>(a[0]);
  ap::Signals s;
  s.focused=flags&1;s.minimized=flags&2;s.locked=flags&4;s.on_battery=flags&8;s.video=flags&16;
  s.webgl=flags&32;s.animation=flags&64;s.loading=flags&128;s.audible=flags&256;s.interacting=flags&512;
  s.idle_ms=a[1];s.free_mem_mb=a[2];s.cpu_pct=a[3];s.active_tab_count=static_cast<int>(a[4]);
  const auto p=ap::runtime_plan(s,static_cast<ap::Tier>(static_cast<int>(a[5])),a[6],a[7],{a[8],a[9],a[10]});
  a[11]=static_cast<int>(p.gpu_tier);a[12]=p.sweep_interval_ms;a[13]=p.deep_idle_sweep;a[14]=p.idle_sleep_ms;
  a[15]=p.hide_inactive_views;a[16]=p.hide_minimized_views;a[17]=p.background_throttling;a[18]=p.sample_metrics;
  return arg;
}
static napi_value init(napi_env e,napi_value exp) {
  napi_value obj,pack;
  if(napi_create_function(e,"object",NAPI_AUTO_LENGTH,object_call,nullptr,&obj)!=napi_ok||
     napi_create_function(e,"packed",NAPI_AUTO_LENGTH,packed_call,nullptr,&pack)!=napi_ok||
     napi_set_named_property(e,exp,"object",obj)!=napi_ok||
     napi_set_named_property(e,exp,"packed",pack)!=napi_ok) return error(e);
  return exp;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
