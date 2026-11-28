"""Standalone offline re-run. Builds only in a new temporary directory (Linux x64)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import tempfile


HEADERS = {
    "node_api.h": "2d4560831e525b47b060ec8a0864ab73993df9e20215ce9f0fe7b24cd31af32a",
    "node_api_types.h": "a25356630d3058f0a0c8937d9f297e9471e037fda58c2696d8a505c2bd99cb00",
    "js_native_api.h": "8808ef8899a1691411928ef5dd7dae0537aedc93d3a34e223b2d89692e79c788",
    "js_native_api_types.h": "4f19cb90d240765cc0961d92a1ee20f65fdc50db7de1ab0a5cb6bc227224e1a0",
}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--electron", type=Path, required=True)
    p.add_argument("--node-include", type=Path, required=True)
    p.add_argument("--core-source", type=Path, help="defaults to REPO/experiments/native-core")
    p.add_argument("--hosts", type=int, default=5, choices=range(1, 10))
    p.add_argument("--paced-seconds", type=int, default=0, choices=[0, 1, 60, 600])
    p.add_argument("--samples", type=int, default=12, choices=range(4, 33))
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64","AMD64"}:
        p.error("this measurement harness uses x64 Linux process counters")
    repo = a.repo.resolve(strict=True)
    core = (a.core_source or repo / "experiments/native-core").resolve(strict=True)
    hdr = a.node_include.resolve(strict=True)
    for n,h in HEADERS.items():
        if hashlib.sha256((hdr/n).read_bytes()).hexdigest() != h:
            p.error("expected unmodified official Node v24.21.0 header: " + n)
    electron = a.electron.resolve(strict=True)
    env = {**os.environ, "ELECTRON_RUN_AS_NODE":"1", "DEX_REPO_ROOT":str(repo)}
    version = subprocess.check_output([str(electron),"-p","process.versions.electron"],env=env,text=True).strip()
    if version != "44.4.5":
        p.error("expected project Electron 44.4.5, got " + version)
    compiler = os.environ.get("CXX","c++")
    def mid(xs): return round(statistics.median(xs), 4)
    with tempfile.TemporaryDirectory(prefix="dex-boundary-rerun-") as tmp:
        work = Path(tmp)
        for x in (Path(__file__).resolve().parent/"bench").iterdir():
            if x.is_file(): shutil.copy2(x,work/x.name)
        for test,lib,output,addon in [
            ("bridge.cpp","adaptive_power","bridge.node",True),
            ("pipe.cpp","adaptive_power","pipe",False),("binary_pipe.cpp","adaptive_power","binary_pipe",False),
            ("memory_packed.cpp","memory_saver","memory.node",True),("tasks_bridge.cpp","task_reminders","tasks.node",True)
        ]:
            cmd=[compiler,"-std=c++17","-O2","-Wall","-Wextra","-Wpedantic","-Werror","-I"+str(core/"include")]
            if addon: cmd += ["-DNAPI_VERSION=8","-fPIC","-shared","-I"+str(hdr)]
            subprocess.run([*cmd,test,str(core/"src"/(lib+".cpp")),"-o",output],cwd=work,check=True)
        def bench(*args):
            return json.loads(subprocess.check_output([str(electron),*args],cwd=work,env=env,text=True,timeout=240))
        if a.paced_seconds:
            cmd=[str(electron),"adaptive_bench.cjs","paced",str(a.paced_seconds*1000),str(a.samples)]
            overall=json.loads(subprocess.check_output(cmd,cwd=work,env=env,text=True,
                               timeout=a.paced_seconds*a.samples+120))
        else:
            observations={k:[] for k in ["hot","cpu","binary","text","memory","packedMemory","tasks"]}
            for i in range(a.hosts):
                for k,cmd in [("hot",("adaptive_bench.cjs","hot")),("cpu",("adaptive_bench.cjs","cpu")),
                              ("binary",("adaptive_bench.cjs","binary")),("text",("adaptive_bench.cjs","ipc")),
                              ("memory",("memory_bench.cjs",)),("packedMemory",("memory_packed_bench.cjs",)),
                              ("tasks",("tasks_bench.cjs",))]:
                    observations[k].append(bench(*cmd))
            overall={"hosts":a.hosts,"electron":version,"architecture":platform.machine(),
                     "scope":"Synthetic policy decisions; not whole-browser or Edge results."}
            for tag,key in [("hot","usPerDecision"),("cpu","processCpuUsPerDecision")]:
                overall[tag+"AdaptiveUs"]={phase:{k:mid([x["results"][phase][key][k]["median"]
                    for x in observations[tag]]) for k in ["js","normalizedJS","napiObject","napiPacked"]}
                    for phase in ["idle","mixed"]}
            overall["binaryPipeUs"]={k:mid([x["results"]["persistentBinaryPipe"][k]["usPerDecision"]["median"]
                for x in observations["binary"]]) for k in ["batch1","batch8","batch32","batch128"]}
            overall["textPipeSingleUs"]=mid([x["results"]["persistentPipe"]["batch1"]["usPerDecision"]["median"]
                                          for x in observations["text"]])
            overall["spawnHelperUs"]=mid([x["results"]["freshHelperOneDecisionUs"]["median"]
                                          for x in observations["text"]])
            overall["memoryUs"]={r["scenario"]:{k:mid([x["rows"][i][k] for x in observations["memory"]])
                for k in ("jsUs","nativeObjectUs")} for i,r in enumerate(observations["memory"][0]["rows"])}
            overall["packedMemoryUs"]={r["scenario"]:{k:mid([x["rows"][i][k] for x in observations["packedMemory"]])
                for k in ("jsUs","nativePackedUs")} for i,r in enumerate(observations["packedMemory"][0]["rows"])}
            overall["tasksCacheMissUs"]={str(r["records"]):{k:mid([x["out"][i]["medianUs"][k]
                for x in observations["tasks"]]) for k in ("original","direct","native")}
                for i,r in enumerate(observations["tasks"][0]["out"])}
        text=json.dumps(overall,indent=2,sort_keys=True)
        if a.out:a.out.write_text(text+"\n",encoding="utf-8")
        print(text)


if __name__=="__main__":main()
