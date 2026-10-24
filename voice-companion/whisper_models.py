"""Model download/cache and conservative hardware selection for the desktop companion."""
from pathlib import Path
import os
import subprocess

MODELS = ("tiny.en", "base.en", "small.en", "medium.en", "large-v3")
REPOS = {
 "tiny.en":"Systran/faster-whisper-tiny.en",
 "base.en":"Systran/faster-whisper-base.en",
 "small.en":"Systran/faster-whisper-small.en",
 "medium.en":"Systran/faster-whisper-medium.en",
 "large-v3":"Systran/faster-whisper-large-v3",
}

def gpu_information():
    """Report NVIDIA GPU for recommendations; do not mistake presence for supported CUDA."""
    try:
        result=subprocess.run(["nvidia-smi","--query-gpu=name,memory.total,compute_cap","--format=csv,noheader,nounits"],
             capture_output=True,text=True,timeout=4,check=True)
        row=result.stdout.strip().splitlines()[0].split(",")
        return {"name":row[0].strip(),"memory_mb":int(row[1].strip()),
                "capability":float(row[2].strip()) if len(row)>2 else 0.0}
    except (OSError,ValueError,IndexError,subprocess.SubprocessError):
        return None

def recommended_model(gpu):
    if not gpu: return "base.en"
    # Older Maxwell cards such as 980 Ti cannot be assumed to work with current CUDA wheels.
    if gpu["capability"] < 7.0: return "base.en"
    memory=gpu["memory_mb"]
    return "large-v3" if memory>=12000 else "medium.en" if memory>=8000 else "small.en" if memory>=5000 else "base.en"

def backend(gpu):
    if gpu and gpu["capability"]>=7.0:
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count()>0:
                supported=ctranslate2.get_supported_compute_types("cuda")
                if "float16" in supported: return "cuda","float16"
                if "int8" in supported: return "cuda","int8"
        except Exception:
            pass
    return "cpu","int8"

def cache_dir(root,model):
    if model not in REPOS: raise ValueError("Unsupported Whisper model")
    return Path(root)/"model"/"whisper"/model

def model_complete(folder):
    folder=Path(folder)
    return all((folder/name).is_file() and (folder/name).stat().st_size>0
               for name in ("model.bin","config.json","tokenizer.json","vocabulary.txt"))

def ensure_whisper_model(root,model,progress=None):
    """Download to one persistent directory; huggingface_hub resumes/cache-validates downloads."""
    if model not in REPOS: raise ValueError("Unsupported Whisper model")
    folder=cache_dir(root,model)
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import disable_progress_bars
    # PyInstaller --windowed has no stderr; tqdm's default bar can raise:
    # AttributeError: 'NoneType' object has no attribute 'write'.
    # The desktop window provides its own progress/status messages.
    disable_progress_bars()
    if progress: progress(5,"Checking/downloading Whisper "+model+"...")
    snapshot_download(repo_id=REPOS[model],local_dir=str(folder),allow_patterns=[
        "config.json","model.bin","tokenizer.json","vocabulary.*","preprocessor_config.json"
    ])
    if not model_complete(folder):
        raise RuntimeError("Whisper model download incomplete")
    if progress: progress(100,"Whisper "+model+" ready")
    return folder
