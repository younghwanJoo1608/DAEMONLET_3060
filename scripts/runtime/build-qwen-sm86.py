"""Explicit, offline Qwen CUDA build and candidate-policy generator.

Requires separately approved source execution and installed tools. Never installs,
downloads, launches Qwen, edits the checkout, or activates an installed runtime.
Generated policies are review inputs, not externally trusted runtime receipts.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = Path(__file__).with_name('qwen-sm86-build.json')
SPEC = json.loads(SPEC_PATH.read_bytes())
POLICIES = ('runtime-qwen-gguf-windows.json', 'runtime-gguf-windows-voxcpm2.json')


def pin(raw):
    return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode()


def ordinary(path, directory=False):
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        info = part.lstat()
        if part.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Linked/reparse paths are not build inputs')
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError('Expected an ordinary ' + ('directory' if directory else 'file'))
    return path


def new_output(path, protected):
    path = Path(os.path.abspath(path))
    ordinary(path.parent, True)
    if path.exists() or any(path == root or path.is_relative_to(root) or root.is_relative_to(path)
                            for root in protected):
        raise ValueError('Output must be new and separate from checkout and source inputs')
    return path


def run(command, log=None):
    result = subprocess.run([str(p) for p in command], check=False, capture_output=True,
                            text=True, encoding='utf-8', errors='replace')
    if log:
        with log.open('a', encoding='utf-8') as stream:
            stream.write(result.stdout + result.stderr)
    result.check_returncode()
    return result.stdout


def verify_source(git, source, expected):
    # Do not fetch, reset, clean, initialize submodules, or trust ignored inputs.
    if run([git, '-C', source, 'rev-parse', 'HEAD']).strip() != expected:
        raise ValueError('Source commit differs from the reviewed pin')
    if run([git, '-C', source, 'status', '--porcelain', '--untracked-files=all', '--ignored']).strip():
        raise ValueError('Source checkout must be clean, including untracked/ignored files')


def read_licenses(qwen, ggml, catalog):
    files = catalog['components']['qwen-cuda']['files']
    result = {}
    for directory, name in ((qwen, 'licenses/qwentts-cpp-MIT.txt'),
                            (ggml, 'licenses/qwentts-ggml-MIT.txt')):
        raw = ordinary(directory / 'LICENSE').read_bytes()
        if pin(raw) != files[name]:
            raise ValueError('Pinned upstream license differs; stage pristine LF source checkouts')
        result[name] = raw
    return result


def configure_command(qwen, ggml, output, cmake, cuda):
    return [str(cmake), '-S', str(qwen), '-B', str(output / 'build'),
            '-G', SPEC['generator'], '-A', 'x64',
            '-T', 'version=' + SPEC['msvcToolset'] + ',cuda=' + str(cuda),
            '-DCMAKE_SYSTEM_VERSION=' + SPEC['windowsSdk'],
            '-DCUDAToolkit_ROOT=' + cuda.as_posix(),
            '-DGGML_SOURCE_DIR=' + ggml.as_posix(), '-DGGML_CUDA=ON',
            '-DCMAKE_CUDA_ARCHITECTURES=' + ';'.join(map(str, SPEC['cudaArchitectures'])),
            '-DGGML_NATIVE=OFF', '-DGGML_METAL=OFF', '-DGGML_VULKAN=OFF',
            '-DGGML_CUDA_GRAPHS=ON', '-DGGML_CUDA_CUB_3DOT2=OFF', '-DGGML_CUDA_NCCL=OFF',
            '-DFETCHCONTENT_FULLY_DISCONNECTED=ON', '-DFETCHCONTENT_UPDATES_DISCONNECTED=ON',
            '-DQWEN_SHARED=ON']


def validate_architectures(text):
    observed = sorted({int(value) for value in re.findall(r'\bsm_(\d+)\b', text)})
    if observed != SPEC['cudaArchitectures']:
        raise ValueError('cuobjdump must show actual SM86 and SM89 device code')
    return observed


def pe_x64_dll(raw):
    if len(raw) < 64 or raw[:2] != b'MZ':
        raise ValueError('Expected a PE x64 DLL')
    offset = struct.unpack_from('<I', raw, 0x3c)[0]
    if offset + 24 > len(raw) or raw[offset:offset+4] != b'PE\0\0':
        raise ValueError('Invalid PE header')
    if struct.unpack_from('<H', raw, offset+4)[0] != 0x8664 or not struct.unpack_from('<H', raw, offset+22)[0] & 0x2000:
        raise ValueError('Expected an AMD64 DLL')


def generate_candidate(source_root, payload, architecture_listing, build_info, output):
    """Data-only generation, after the approved build has inspected its real DLL.

    No production policy changes here. The caller must review generated policy
    diffs, validate ABI/inference, and explicitly adopt the candidate in a test app.
    """
    architectures = validate_architectures(architecture_listing)
    voice = source_root / 'electron/voice'
    raw_catalog = (voice / 'managed-gguf-runtime-catalog.json').read_bytes()
    catalog = json.loads(raw_catalog)
    policies = {name: json.loads((voice / name).read_bytes()) for name in POLICIES}
    catalog_pin = dict(filename='managed-gguf-runtime-catalog.json', **pin(raw_catalog))
    if any(policy['managedRuntimeCatalog'] != catalog_pin for policy in policies.values()):
        raise ValueError('Source catalog and worker policy pins differ')
    qwen = policies[POLICIES[0]]
    if any(qwen[key] != SPEC[key] for key in ('sourceCommit', 'ggmlCommit', 'abiVersion', 'cudaVersion')):
        raise ValueError('Build specification and worker policy differ')
    expected = {'native/' + name for name in SPEC['nativeFiles']}
    licenses = {'licenses/qwentts-cpp-MIT.txt', 'licenses/qwentts-ggml-MIT.txt'}
    if set(payload) != expected | licenses:
        raise ValueError('Unexpected native payload file set')
    previous = catalog['components']['qwen-cuda']
    for name in licenses:
        if pin(payload[name]) != previous['files'][name]:
            raise ValueError('Pinned upstream license differs')
    for name in expected:
        pe_x64_dll(payload[name])
    if pin(payload['native/ggml-cuda.dll']) == qwen['backends']['cuda']['binaries']['ggml-cuda.dll']:
        raise ValueError('SM89-only CUDA DLL cannot become an SM86 candidate')
    output = new_output(output, [source_root.resolve()])
    output.mkdir()
    native_pin = pin(payload['native/ggml-cuda.dll'])
    archive_name = 'qwen-cuda-sm86-sm89-' + native_pin['sha256'][:12] + '.zip'
    archive_path = output / archive_name
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(payload.items()):
            entry = zipfile.ZipInfo(name, (2000, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, raw)
    provenance = dict(kind='qwen-sm86-source-build', sourceCommit=SPEC['sourceCommit'],
                      ggmlCommit=SPEC['ggmlCommit'], sourceLicense='MIT',
                      cudaVersion=SPEC['cudaVersion'], cudaArchitectures=architectures,
                      gpuInferenceValidated=False, cleanHostVerified=False,
                      buildSpecSha256=pin(SPEC_PATH.read_bytes())['sha256'],
                      architectureListingSha256=pin(architecture_listing.encode())['sha256'])
    catalog['components']['qwen-cuda'] = dict(id='qwen-cuda',
        archive=dict(name=archive_name, format='zip', bundledPath=archive_name, **pin(archive_path.read_bytes())),
        files={name: pin(raw) for name, raw in sorted(payload.items())}, provenance=provenance)
    catalog['runtimes']['qwen-cuda']['support'] = dict(cudaComputeCapabilities=[[8, 6], [8, 9]],
        minimumCudaDriverApi=13000, minimumDriverBranch=580, validatedGpuNames=[],
        validationScope='qwen-sm86-build-candidate')
    binaries = {name: pin(payload['native/' + name]) for name in SPEC['nativeFiles']}
    # Keep legacy aliases coherent, but do not touch models, ABI or Vulkan pins.
    qwen['binaries'] = copy.deepcopy(binaries)
    qwen['backends']['cuda']['binaries'] = binaries
    for build in (qwen['build'], qwen['backends']['cuda']['build']):
        build.update(build_info)
        build['cudaArchitectures'] = ';'.join(map(str, architectures))
    updated_catalog = json_bytes(catalog)
    (output / 'managed-gguf-runtime-catalog.json').write_bytes(updated_catalog)
    for name, policy in policies.items():
        policy['managedRuntimeCatalog'] = dict(filename='managed-gguf-runtime-catalog.json', **pin(updated_catalog))
        (output / name).write_bytes(json_bytes(policy))
    result = dict(status='BUILT_NOT_GPU_VALIDATED', artifact=archive_name,
                  nativeFiles=binaries, architectures=architectures,
                  abiExecuted=False, gpuInferenceValidated=False, installedAppChanged=False)
    (output / 'candidate-result.json').write_bytes(json_bytes(result))
    (output / 'cuobjdump-list-elf.txt').write_text(architecture_listing, encoding='utf-8')
    return result


def build(args):
    if not args.execute_build:
        raise ValueError('Build execution requires --execute-build after explicit approval')
    if sys.platform != 'win32' or sys.maxsize <= 2**32:
        raise ValueError('Windows x64 is required')
    qwen, ggml, cuda = (ordinary(p, True) for p in (args.qwen_source, args.ggml_source, args.cuda_root))
    cmake, git = (ordinary(p) for p in (args.cmake, args.git))
    output = new_output(args.output, [ROOT, qwen, ggml, cuda])
    verify_source(git, qwen, SPEC['sourceCommit'])
    verify_source(git, ggml, SPEC['ggmlCommit'])
    catalog = json.loads((ROOT / 'electron/voice/managed-gguf-runtime-catalog.json').read_bytes())
    licenses = read_licenses(qwen, ggml, catalog)
    nvcc = ordinary(cuda / 'bin/nvcc.exe')
    cuobjdump = ordinary(cuda / 'bin/cuobjdump.exe')
    compiler = run([nvcc, '--version'])
    if not re.search(r'release 13\.0,\s+V13\.0\.48\b', compiler):
        raise ValueError('Use the reviewed CUDA Toolkit 13.0.48')
    cmake_version = run([cmake, '--version']).splitlines()[0]
    output.mkdir()
    configure = configure_command(qwen, ggml, output, cmake, cuda)
    compile_command = [cmake, '--build', output / 'build', '--config', 'Release',
                       '--target', 'qwen', 'qwen-tts', 'test-abi-c', '--parallel', '4']
    run(configure, output / 'build.log')
    run(compile_command, output / 'build.log')
    payload = {}
    for name in SPEC['nativeFiles']:
        matches = list((output / 'build').rglob(name))
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous build output: ' + name)
        payload['native/' + name] = ordinary(matches[0]).read_bytes()
    cuda_dll = next((output / 'build').rglob('ggml-cuda.dll'))
    listing = run([cuobjdump, '--list-elf', cuda_dll])
    validate_architectures(listing)
    if ordinary(cuda_dll).read_bytes() != payload['native/ggml-cuda.dll']:
        raise ValueError('CUDA DLL changed during device-code inspection')
    payload.update(licenses)
    # Detect a source edit during configure/compile before generating any policy.
    verify_source(git, qwen, SPEC['sourceCommit'])
    verify_source(git, ggml, SPEC['ggmlCommit'])
    build_info = dict(generator=SPEC['generator'], toolset='MSVC ' + SPEC['msvcToolset'],
                      cmake=cmake_version.removeprefix('cmake version '), cuda='13.0.48',
                      windowsSdk=SPEC['windowsSdk'])
    result = generate_candidate(ROOT, payload, listing, build_info, output / 'candidate')
    receipt = dict(result, configureCommand=configure,
                   buildCommand=[str(p) for p in compile_command], build=build_info,
                   sourceCommit=SPEC['sourceCommit'], ggmlCommit=SPEC['ggmlCommit'])
    (output / 'build-receipt.json').write_bytes(json_bytes(receipt))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('qwen-source', 'ggml-source', 'cuda-root', 'cmake', 'git', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--execute-build', action='store_true')
    arguments = parser.parse_args()
    print(json.dumps(build(arguments), indent=2))
