#include <node_api.h>
#include "dexerion/task_reminders.hpp"
#include <cmath>
#include <exception>
#include <string_view>
#include <vector>
namespace tr=dexerion::task_reminders;
static napi_value bad(napi_env e){napi_throw_type_error(e,nullptr,"Invalid normalized task fixture");return nullptr;}
static bool num(napi_env e,napi_value o,const char* k,double& x){napi_value v;return
 napi_get_named_property(e,o,k,&v)==napi_ok&&napi_get_value_double(e,v,&x)==napi_ok&&std::isfinite(x)&&x>0;}
static napi_value sorted(napi_env e,napi_callback_info info){
 try{
  size_t nargs=1;napi_value a;uint32_t n=0;
  if(napi_get_cb_info(e,info,&nargs,&a,nullptr,nullptr)!=napi_ok||nargs!=1||
    napi_get_array_length(e,a,&n)!=napi_ok||n>10000)return bad(e);
  std::vector<tr::Task> rows(n);std::vector<napi_value> source(n);
  for(uint32_t i=0;i<n;++i){
   auto& t=rows[i];napi_value id,prio,done;
   if(napi_get_element(e,a,i,&source[i])!=napi_ok)return bad(e);
   auto o=source[i];
   if(napi_get_named_property(e,o,"id",&id)!=napi_ok||napi_get_named_property(e,o,"priority",&prio)!=napi_ok||
    napi_get_named_property(e,o,"done",&done)!=napi_ok||napi_get_value_bool(e,done,&t.done)!=napi_ok||
    !num(e,o,"dueMs",t.due_ms)||!num(e,o,"createdAt",t.created_at_ms))return bad(e);
   size_t len;
   if(napi_get_value_string_utf16(e,id,nullptr,0,&len)!=napi_ok||len==0||len>4096)return bad(e);
   t.id.resize(len+1);size_t size=0;
   if(napi_get_value_string_utf16(e,id,t.id.data(),t.id.size(),&size)!=napi_ok||size!=len)return bad(e);
   t.id.resize(len);
   char p[16];if(napi_get_value_string_utf8(e,prio,p,sizeof(p),&size)!=napi_ok)return bad(e);
   const auto v=std::string_view(p,size);
   if(v=="high")t.priority=tr::Priority::high;else if(v=="medium")t.priority=tr::Priority::medium;
   else if(v=="low")t.priority=tr::Priority::low;else return bad(e);
  }
  const auto order=tr::sort_tasks(rows);napi_value out;
  if(napi_create_array_with_length(e,order.size(),&out)!=napi_ok)return bad(e);
  for(size_t i=0;i<order.size();++i)
   if(napi_set_element(e,out,static_cast<uint32_t>(i),source[order[i]])!=napi_ok)return bad(e);
  return out;
 } catch(const std::exception&){return bad(e);}
}
static napi_value init(napi_env e,napi_value exp){napi_value fn;
 if(napi_create_function(e,"sort",NAPI_AUTO_LENGTH,sorted,nullptr,&fn)!=napi_ok||
    napi_set_named_property(e,exp,"sort",fn)!=napi_ok)return bad(e);
 return exp;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
