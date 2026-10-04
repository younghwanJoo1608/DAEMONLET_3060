"""CPU-only synthetic PE/policy fixtures. No upstream tools, DLLs or GPU execute."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('qwen_sm86_build', ROOT / 'scripts/runtime/build-qwen-sm86.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def fake_dll(name):
    raw = bytearray(128)
    raw[:2] = b'MZ'
    struct.pack_into('<I', raw, 0x3c, 64)
    raw[64:68] = b'PE\0\0'
    struct.pack_into('<H', raw, 68, 0x8664)
    struct.pack_into('<H', raw, 86, 0x2000)
    return bytes(raw) + name.encode()


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.base = Path(self.scratch.name).resolve()
        self.source = self.base / 'source'
        self.voice = self.source / 'electron/voice'
        self.voice.mkdir(parents=True)
        self.output = self.base / 'candidate'
        self.catalog = json.loads((ROOT / 'electron/voice/managed-gguf-runtime-catalog.json').read_bytes())
        self.policies = {name: json.loads((ROOT / 'electron/voice' / name).read_bytes()) for name in builder.POLICIES}
        self.payload = {'native/' + name: fake_dll(name) for name in builder.SPEC['nativeFiles']}
        for name in ('licenses/qwentts-cpp-MIT.txt', 'licenses/qwentts-ggml-MIT.txt'):
            raw = b'Synthetic fixture license, not distributed'
            self.payload[name] = raw
            self.catalog['components']['qwen-cuda']['files'][name] = builder.pin(raw)
        self.persist()

    def tearDown(self):
        self.scratch.cleanup()

    def persist(self):
        raw = builder.json_bytes(self.catalog)
        (self.voice / 'managed-gguf-runtime-catalog.json').write_bytes(raw)
        for name, policy in self.policies.items():
            policy['managedRuntimeCatalog'] = dict(filename='managed-gguf-runtime-catalog.json', **builder.pin(raw))
            (self.voice / name).write_bytes(builder.json_bytes(policy))

    def generate(self, listing='ELF file 1: kernel.sm_86.cubin\nELF file 2: kernel.sm_89.cubin\n'):
        return builder.generate_candidate(self.source, self.payload, listing,
            dict(generator='fixture', cuda='13.0.48'), self.output)

    def test_real_payload_hashes_and_catalog_chain_preserve_other_engines(self):
        original = {p: p.read_bytes() for p in self.voice.iterdir()}
        with patch.object(builder.subprocess, 'run', side_effect=AssertionError('No execution')):
            result = self.generate()
        self.assertFalse(result['gpuInferenceValidated'])
        self.assertFalse(result['abiExecuted'])
        self.assertEqual({p: p.read_bytes() for p in self.voice.iterdir()}, original)
        raw_catalog = (self.output / 'managed-gguf-runtime-catalog.json').read_bytes()
        catalog = json.loads(raw_catalog)
        for key in self.catalog['components']:
            if key != 'qwen-cuda': self.assertEqual(catalog['components'][key], self.catalog['components'][key])
        for key in self.catalog['runtimes']:
            if key != 'qwen-cuda': self.assertEqual(catalog['runtimes'][key], self.catalog['runtimes'][key])
        component = catalog['components']['qwen-cuda']
        archive_path = self.output / result['artifact']
        self.assertEqual(builder.pin(archive_path.read_bytes()),
                         {k: component['archive'][k] for k in ('bytes','sha256')})
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(set(archive.namelist()), set(self.payload))
            for name in archive.namelist():
                self.assertEqual(builder.pin(archive.read(name)), component['files'][name])
        for name, before in self.policies.items():
            after = json.loads((self.output / name).read_bytes())
            self.assertEqual(after['managedRuntimeCatalog'],
                dict(filename='managed-gguf-runtime-catalog.json', **builder.pin(raw_catalog)))
            if name == builder.POLICIES[0]:
                self.assertEqual(after['models'], before['models'])
                self.assertEqual(after['abiLayout'], before['abiLayout'])
                self.assertEqual(after['backends']['vulkan'], before['backends']['vulkan'])
                self.assertEqual(after['binaries'], after['backends']['cuda']['binaries'])
            else:
                after['managedRuntimeCatalog'] = before['managedRuntimeCatalog']
                self.assertEqual(after, before)

    def test_sm89_or_ptx_only_output_cannot_be_promoted(self):
        for listing in ('sm_89', 'compute_86 sm_89', 'sm_86', 'sm_86 sm_89 sm_75'):
            with self.subTest(listing=listing), self.assertRaises(ValueError): self.generate(listing)
        self.assertFalse(self.output.exists())

    def test_unknown_dll_and_changed_license_are_rejected(self):
        self.payload['native/unapproved.dll'] = fake_dll('extra')
        with self.assertRaises(ValueError): self.generate()
        del self.payload['native/unapproved.dll']
        self.payload['licenses/qwentts-cpp-MIT.txt'] += b'changed'
        with self.assertRaises(ValueError): self.generate()

    def test_catalog_and_source_pin_drift_are_rejected(self):
        policy_path = self.voice / builder.POLICIES[0]
        policy = json.loads(policy_path.read_bytes())
        policy['managedRuntimeCatalog']['sha256'] = '0'*64
        policy_path.write_bytes(builder.json_bytes(policy))
        with self.assertRaises(ValueError): self.generate()
        self.persist()
        policy = json.loads(policy_path.read_bytes())
        policy['sourceCommit'] = '0'*40
        policy_path.write_bytes(builder.json_bytes(policy))
        with self.assertRaises(ValueError): self.generate()

    def test_relabeling_unchanged_cuda_binary_is_rejected(self):
        self.policies[builder.POLICIES[0]]['backends']['cuda']['binaries']['ggml-cuda.dll'] = builder.pin(self.payload['native/ggml-cuda.dll'])
        self.persist()
        with self.assertRaises(ValueError): self.generate()

    def test_output_never_overwrites_source_or_existing_directory(self):
        self.output = self.source / 'candidate'
        with self.assertRaises(ValueError): self.generate()
        self.output = self.base / 'existing'; self.output.mkdir()
        marker = self.output / 'keep'; marker.write_bytes(b'keep')
        with self.assertRaises(ValueError): self.generate()
        self.assertEqual(marker.read_bytes(), b'keep')

    def test_pe_machine_and_dll_flag(self):
        raw = bytearray(fake_dll('test'))
        struct.pack_into('<H', raw, 68, 0x14c)
        with self.assertRaises(ValueError): builder.pe_x64_dll(raw)
        with self.assertRaises(ValueError): builder.pe_x64_dll(b'MZ')

    def test_build_is_explicit_offline_and_keeps_fixed_source_pins(self):
        class Args: execute_build = False
        with patch.object(builder.subprocess, 'run', side_effect=AssertionError('Must not execute')):
            with self.assertRaises(ValueError): builder.build(Args())
        command = builder.configure_command(Path('qwen'), Path('ggml'), Path('output'), Path('cmake'), Path('cuda'))
        for option in ('-DCMAKE_CUDA_ARCHITECTURES=86;89', '-DFETCHCONTENT_FULLY_DISCONNECTED=ON',
                       '-DGGML_CUDA_CUB_3DOT2=OFF', '-DGGML_CUDA_NCCL=OFF', '-DQWEN_SHARED=ON',
                       '-DCUDAToolkit_ROOT=cuda'):
            self.assertIn(option, command)

    def test_failed_build_keeps_diagnostics(self):
        log = self.base / 'build.log'
        failed = subprocess.CompletedProcess(['fixture'], 1, 'compiler output', 'compiler error')
        with patch.object(builder.subprocess, 'run', return_value=failed), self.assertRaises(subprocess.CalledProcessError):
            builder.run(['fixture'], log)
        self.assertEqual(log.read_text(), 'compiler outputcompiler error')

    def test_wrong_commit_or_dirty_sources_fail_before_configure(self):
        with patch.object(builder, 'run', return_value='0'*40), self.assertRaises(ValueError):
            builder.verify_source('git', self.source, builder.SPEC['sourceCommit'])
        with patch.object(builder, 'run', side_effect=[builder.SPEC['sourceCommit'], '?? injected.cmake']), self.assertRaises(ValueError):
            builder.verify_source('git', self.source, builder.SPEC['sourceCommit'])

    def test_license_line_endings_are_checked_before_build(self):
        qwen = self.base / 'qwen'; qwen.mkdir()
        ggml = self.base / 'ggml'; ggml.mkdir()
        for directory, name in ((qwen, 'licenses/qwentts-cpp-MIT.txt'),
                                (ggml, 'licenses/qwentts-ggml-MIT.txt')):
            raw = b'Pinned license\n'
            (directory / 'LICENSE').write_bytes(raw)
            self.catalog['components']['qwen-cuda']['files'][name] = builder.pin(raw)
        self.assertEqual(len(builder.read_licenses(qwen, ggml, self.catalog)), 2)
        (ggml / 'LICENSE').write_bytes(b'Pinned license\r\n')
        with self.assertRaisesRegex(ValueError, 'LF source checkouts'):
            builder.read_licenses(qwen, ggml, self.catalog)


if __name__ == '__main__':
    unittest.main()
