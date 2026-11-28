cmake_minimum_required(VERSION 3.16)
project(dexerion_native_core LANGUAGES CXX)

add_library(dex_memory_saver STATIC src/memory_saver.cpp)
target_include_directories(dex_memory_saver PUBLIC include)
target_compile_features(dex_memory_saver PUBLIC cxx_std_17)
set_target_properties(dex_memory_saver PROPERTIES CXX_EXTENSIONS OFF)

add_library(dex_adaptive_power STATIC src/adaptive_power.cpp)
target_include_directories(dex_adaptive_power PUBLIC include)
target_compile_features(dex_adaptive_power PUBLIC cxx_std_17)
set_target_properties(dex_adaptive_power PROPERTIES CXX_EXTENSIONS OFF)

include(CTest)
if(BUILD_TESTING)
  add_executable(dex_ms_unit tests/memory_saver_unit.cpp)
  target_link_libraries(dex_ms_unit PRIVATE dex_memory_saver)
  add_test(NAME memory_saver_unit COMMAND dex_ms_unit)

  add_executable(dex_ms_replay tests/memory_saver_replay.cpp)
  target_link_libraries(dex_ms_replay PRIVATE dex_memory_saver)
  add_executable(dex_ap_unit tests/adaptive_power_unit.cpp)
  target_link_libraries(dex_ap_unit PRIVATE dex_adaptive_power)
  add_test(NAME adaptive_power_unit COMMAND dex_ap_unit)
  add_executable(dex_ap_replay tests/adaptive_power_replay.cpp)
  target_link_libraries(dex_ap_replay PRIVATE dex_adaptive_power)

  find_program(DEX_NODE_EXECUTABLE NAMES node nodejs)
  if(NOT DEX_NODE_EXECUTABLE)
    message(FATAL_ERROR "Node is required to run native/JS parity tests; install Node or set BUILD_TESTING=OFF for library-only builds.")
  endif()
  add_test(NAME memory_saver_js_parity COMMAND "${DEX_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/memory_saver_parity.cjs" $<TARGET_FILE:dex_ms_replay>)
  add_test(NAME adaptive_power_js_parity COMMAND "${DEX_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/adaptive_power_parity.cjs" $<TARGET_FILE:dex_ap_replay>)
endif()
