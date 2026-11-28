#include <node_api.h>
#include "dexerion/memory_saver.hpp"
#include <cmath>
#include <exception>
#include <string>
#include <vector>
namespace ms=dexerion::memory_saver;
static napi_value bad(napi_env e){napi_throw_type_error(e,nullptr,"Invalid normalized memory fixture");return nullptr;}
static bool dprop(napi_env e,napi_value o,const char* n,double& out){napi_value v;return napi_get_named_property(e,o,n,&v)==napi_ok&&napi_get_value_double(e,v,&out)==napi_ok&&std::isfinite(out);}
static bool bprop(napi_env e,napi_value o,const char* n,bool& out){napi_value v;return napi_get_named_property(e,o,n,&v)==napi_ok&&napi_get_value_bool(e,v,&out)==napi_ok;}
static bool sprop(napi_env e,napi_value o,const char* n,std::string& out){
 napi_value v;size_t size=0; if(napi_get_named_property(e,o,n,&v)!=napi_ok||napi_get_value_string_utf8(e,v,nullptr,0,&size)!=napi_ok||size>65536)return false;
 out.resize(size+1);size_t wrote=0;
 if(napi_get_value_string_utf8(e,v,out.data(),out.size(),&wrote)!=napi_ok||wrote!=size)return false;
 out.resize(wrote);return true;
}
static bool numout(napi_env e,napi_value out,const char* k,double x){napi_value v;return napi_create_double(e,x,&v)==napi_ok&&napi_set_named_property(e,out,k,v)==napi_ok;}
static napi_value call(napi_env e,napi_callback_info info){
 try {
  napi_value a[2];size_t n=2;uint32_t len=0;
  if(napi_get_cb_info(e,info,&n,a,nullptr,nullptr)!=napi_ok||n!=2||
     napi_get_array_length(e,a[0],&len)!=napi_ok||len>10000)return bad(e);
  ms::SweepInput input;
  if(!dprop(e,a[1],"totalMB",input.total_mb)||!dprop(e,a[1],"capMB",input.cap_mb)||
     !dprop(e,a[1],"now",input.now_ms)||!dprop(e,a[1],"floorMs",input.floor_ms))return bad(e);
  std::vector<ms::TabSnapshot> tabs;std::vector<napi_value> jsTabs;
  if(input.total_mb>input.cap_mb&&input.cap_mb>0) {
   tabs.reserve(len);jsTabs.reserve(len);
   for(uint32_t i=0;i<len;++i){napi_value o,win,pid;ms::TabSnapshot t;
    if(napi_get_element(e,a[0],i,&o)!=napi_ok||
      napi_get_named_property(e,o,"winId",&win)!=napi_ok||napi_get_value_int64(e,win,&t.window_id)!=napi_ok||
      napi_get_named_property(e,o,"pid",&pid)!=napi_ok||napi_get_value_uint32(e,pid,&t.pid)!=napi_ok||
      !sprop(e,o,"tabId",t.tab_id)||!sprop(e,o,"url",t.url)||!dprop(e,o,"memMB",t.memory_mb)||
      !dprop(e,o,"lastActive",t.last_active_ms)||!bprop(e,o,"active",t.active)||!bprop(e,o,"loading",t.loading)||
      !bprop(e,o,"lazy",t.lazy)||!bprop(e,o,"sleeping",t.sleeping)||!bprop(e,o,"hasView",t.has_view)||
      !bprop(e,o,"audible",t.audible))return bad(e);
    tabs.push_back(std::move(t));jsTabs.push_back(o);
   }
  }
  const auto plan=ms::plan_sweep(tabs,input);
  napi_value out,vics;
  if(napi_create_object(e,&out)!=napi_ok||napi_create_array_with_length(e,plan.victims.size(),&vics)!=napi_ok||
     napi_set_named_property(e,out,"victims",vics)!=napi_ok||!numout(e,out,"projectedMB",plan.projected_mb)||
     !numout(e,out,"overMB",plan.over_mb))return bad(e);
  for(size_t i=0;i<plan.victims.size();++i)if(napi_set_element(e,vics,static_cast<uint32_t>(i),jsTabs[plan.victims[i]])!=napi_ok)return bad(e);
  return out;
 }catch(const std::exception&){return bad(e);}
}

static napi_value packed(napi_env e,napi_callback_info info){
 try{
  napi_value arg,buffer;size_t nargs=1,len=0,offset=0;void* ptr=nullptr;napi_typedarray_type type;
  if(napi_get_cb_info(e,info,&nargs,&arg,nullptr,nullptr)!=napi_ok||nargs!=1||
     napi_get_typedarray_info(e,arg,&type,&len,&ptr,&buffer,&offset)!=napi_ok||
     type!=napi_float64_array||!ptr||len<8)return bad(e);
  auto* a=static_cast<double*>(ptr);
  for(size_t j=0;j<5;++j)if(!std::isfinite(a[j]))return bad(e);
  if(a[4]<0||a[4]>10000||std::floor(a[4])!=a[4])return bad(e);
  const auto count=static_cast<size_t>(a[4]);if(len<8+7*count)return bad(e);
  ms::SweepInput input{a[0],a[1],a[2],a[3]};
  std::vector<ms::TabSnapshot> rows(count);
  for(size_t i=0;i<count;++i){
   auto& t=rows[i];const auto* v=a+5+6*i;
   for(size_t j=0;j<6;++j)if(!std::isfinite(v[j]))return bad(e);
   if(v[0]<0||v[0]>127||v[1]<0||v[1]>10000||v[2]<0||v[2]>4294967295.0)return bad(e);
   auto f=static_cast<unsigned>(v[0]);
   t.window_id=static_cast<std::int64_t>(v[1]);t.pid=static_cast<std::uint32_t>(v[2]);
   t.memory_mb=v[3];t.last_active_ms=v[4];
   t.active=f&1;t.loading=f&2;t.lazy=f&4;t.sleeping=f&8;t.has_view=f&16;t.audible=f&32;
   if(f&64)t.url="dexerion://blocked";
  }
  const auto p=ms::plan_sweep(rows,input);auto* out=a+5+6*count;
  out[0]=p.projected_mb;out[1]=p.over_mb;out[2]=static_cast<double>(p.victims.size());
  for(size_t i=0;i<p.victims.size();++i)out[3+i]=static_cast<double>(p.victims[i]);
  return arg;
 }catch(const std::exception&){return bad(e);}
}

static napi_value init(napi_env e,napi_value exp){napi_value fn;
 if(napi_create_function(e,"plan",NAPI_AUTO_LENGTH,call,nullptr,&fn)!=napi_ok||
  napi_set_named_property(e,exp,"plan",fn)!=napi_ok)return bad(e);
 napi_value pk;
 if(napi_create_function(e,"packed",NAPI_AUTO_LENGTH,packed,nullptr,&pk)!=napi_ok||
    napi_set_named_property(e,exp,"packed",pk)!=napi_ok)return bad(e);
 return exp;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
