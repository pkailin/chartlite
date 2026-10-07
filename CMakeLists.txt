cmake_minimum_required(VERSION 3.8)
project(chartlite NONE)

find_package(ament_cmake REQUIRED)

# ONLY launch/. The bundle is deliberately NOT installed.
#
# dataviz copy-installs its web bundle, which `--symlink-install` does not
# cover, so an edit to its sources does not reach install/ until a rebuild — and
# it needs a freshness gate to catch the resulting stale copy, a gate that
# refuses to launch. Nothing is copied here, so there is no second copy that can
# drift and nothing to gate: chartlite.launch.py resolves back to the source
# tree and serve.mjs hands out dist/ from there.
#
# The cost is that this package is not relocatable — an install/ tree without
# its source beside it cannot serve. That is the right trade for a dev tool and
# it is stated in the README rather than discovered.
install(
  DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)

if(BUILD_TESTING)
  # REQUIRED, so a host without npm FAILS configuration rather than producing a
  # package whose tests silently do not exist.
  #
  # `colcon test --packages-select dataviz` passes vacuously — its generated
  # CTest file is empty — while that package sits in the repo's gating
  # regression scope, so a green result there is evidence of nothing. This
  # package must not acquire the same property.
  find_program(NPM_EXECUTABLE npm REQUIRED)

  add_test(
    NAME chartlite_vitest
    COMMAND ${NPM_EXECUTABLE} test
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  )
  # The suite needs node_modules. Without them vitest is absent and the test
  # fails loudly, which is the intended outcome — never a skip.
  set_tests_properties(chartlite_vitest PROPERTIES TIMEOUT 300)
endif()

ament_package()
