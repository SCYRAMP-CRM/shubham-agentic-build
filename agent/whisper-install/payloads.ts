// Data only: every file of the official whisper.cpp b5454 Windows CPU archive (whisper-bin-x64.zip), each by size and SHA-256,
// read from the archive after its own SHA-256 matched (manifest.ts). install.ts checks each extracted file against this.
export interface PayloadFile { file: string; bytes: number; sha256: string }
export const PAYLOADS: Readonly<Record<'windows', readonly PayloadFile[]>> = {
    "windows":  [
                    {
                        "sha256":  "53d2af0db387f7270fe4d969a41684313063ec91f422c4ff27963896cea9fdb5",
                        "file":  "test-whisper-buffer-loader.exe",
                        "bytes":  11264
                    },
                    {
                        "sha256":  "1c8a5c758f21f5682d4fd1f67b1871ffbcc5b6adf784eb5507297073f40f3b7f",
                        "file":  "test-vad.exe",
                        "bytes":  354304
                    },
                    {
                        "sha256":  "b306e8966a0783eb02a56f2a1cc6e602629930365a94b52e315ea379df744c8d",
                        "file":  "test-whisper-lang-detect-abort.exe",
                        "bytes":  13312
                    },
                    {
                        "sha256":  "01b112d6ac968fa13d3df6500bd24e771f1bee29df15989d6cb72efaf946f630",
                        "file":  "wchess.exe",
                        "bytes":  178688
                    },
                    {
                        "sha256":  "00a7b343074d6c45cf5b69e598b6a62a0d7c44e4b54968074086b0c8846f6cb4",
                        "file":  "test-whisper-zero-samples.exe",
                        "bytes":  11776
                    },
                    {
                        "sha256":  "0d96b6e2738e8437be2d209cf3b6b5fe9be9ddf1f70e627d587a0a54dcf97aa3",
                        "file":  "test-parakeet-full-gb1.exe",
                        "bytes":  366080
                    },
                    {
                        "sha256":  "8c4a36989dbf1a0313761aa13fa6a43ac1ce316425a18f9c4361c422891092c6",
                        "file":  "test-parakeet-full-diffusion.exe",
                        "bytes":  369664
                    },
                    {
                        "sha256":  "bd5bad69933675a8e92a6f4a1ab9290ae25526ec9b6907a04ebb3f4801d963a8",
                        "file":  "test-parakeet-full-jfk.exe",
                        "bytes":  366080
                    },
                    {
                        "sha256":  "f617a0f8cefe100a5db66ef0a81c517b211d454a2780bedd7b6dbfbd1a15eaea",
                        "file":  "test-vad-full.exe",
                        "bytes":  355840
                    },
                    {
                        "sha256":  "633c1d7cbdbd75a06ea80e25b84d4fbe9e648a9f2e1e91cab5c26d99ce1e9a42",
                        "file":  "test-parakeet.exe",
                        "bytes":  354816
                    },
                    {
                        "sha256":  "f1099fca8a6762702467c4df52f999d8788922918515cef91e01284d444876c7",
                        "file":  "whisper-stream.exe",
                        "bytes":  378368
                    },
                    {
                        "sha256":  "a97456e747f28e7bb09c1dac35f40d94404c5ecffa74aaaaa7a3753ea6543121",
                        "file":  "whisper-server.exe",
                        "bytes":  726016
                    },
                    {
                        "sha256":  "99fb5d291cfa385eea005fb4f313e5ee496f2c40d546079bac797e7523bc0117",
                        "file":  "whisper-talk-llama.exe",
                        "bytes":  457728
                    },
                    {
                        "sha256":  "034396d75bb5720c1851674ff64a96192b58f6927b68d334ebd254ce6cad9674",
                        "file":  "whisper.dll",
                        "bytes":  1370112
                    },
                    {
                        "sha256":  "012d801ff1b69b1c8bbd55659561b0e43258bc8dffae19cb6f236e5ccc52d089",
                        "file":  "whisper-vad-speech-segments.exe",
                        "bytes":  362496
                    },
                    {
                        "sha256":  "331dba46d6427105d2b802cdbc7eae916ea1c5abf9b0d3b5cfe460d8db8e4366",
                        "file":  "whisper-cli.exe",
                        "bytes":  479744
                    },
                    {
                        "sha256":  "d1425cdd3d130af16f6bb57e56dfb7ca42071d7e7bd9373ad2190ff7b0fcda92",
                        "file":  "whisper-bench.exe",
                        "bytes":  20480
                    },
                    {
                        "sha256":  "b8ac7c869ab036843054ec280cc3e78f37e6c35234ee6e6cc8b5e63af8498709",
                        "file":  "whisper-command.exe",
                        "bytes":  176640
                    },
                    {
                        "sha256":  "04cacf442510a5c540946a8629306c52631d9b46b44c9c78f2a076e39cfff3fc",
                        "file":  "whisper-quantize.exe",
                        "bytes":  111616
                    },
                    {
                        "sha256":  "2b31873e8937ad0b9a3be5455bf7ca84cf515fae13edfa3614d8867f3c06dac2",
                        "file":  "whisper-lsp.exe",
                        "bytes":  180736
                    },
                    {
                        "sha256":  "f9b60cfec215988fe2af8b2967610d08f828f086ecf73a2932140f7a4c4f18f5",
                        "file":  "test-common-utf8.exe",
                        "bytes":  324608
                    },
                    {
                        "sha256":  "1306b1014c8118d27234d8ddc0e66ced1f8c8476bf85071595fd182ea9b7263b",
                        "file":  "ggml-cpu-haswell.dll",
                        "bytes":  1010688
                    },
                    {
                        "sha256":  "4b11c427b844eeac87529af9a8d94b35aad2024666beb2a35e59fe3077e4b81e",
                        "file":  "ggml-cpu-cascadelake.dll",
                        "bytes":  1061376
                    },
                    {
                        "sha256":  "2b4dc4c66e7d8fe2807283816e9cf3b7f7d0556f59df34069871e37eab8aed40",
                        "file":  "ggml-cpu-icelake.dll",
                        "bytes":  1061376
                    },
                    {
                        "sha256":  "1774714cf93621406ff35344b54715619a83242ae3e331e44d98a3b35ce801be",
                        "file":  "ggml-cpu-skylakex.dll",
                        "bytes":  1049600
                    },
                    {
                        "sha256":  "04edbdebc01a1d421062a960881a4f34d520d99693999518243f332406444c6e",
                        "file":  "ggml-cpu-sandybridge.dll",
                        "bytes":  1026560
                    },
                    {
                        "sha256":  "069cb77343a6056472a2f38cfe0530d534ee252310336062c630d6f150ec263a",
                        "file":  "command.exe",
                        "bytes":  27648
                    },
                    {
                        "sha256":  "0998ddcc20eabdb410b7c736f71b5908e6a0619360075976d886e621f6112ee6",
                        "file":  "bench.exe",
                        "bytes":  27648
                    },
                    {
                        "sha256":  "bede0d6b2d387236ecd2b5dd676d51c8984b5b6e0ae461a12174e9c01345c5f0",
                        "file":  "ggml-base.dll",
                        "bytes":  693248
                    },
                    {
                        "sha256":  "74127b40abd4f595d9db6af0fa313a02e18ff42fc228bfa05281e7c788dd4507",
                        "file":  "ggml-cpu-cannonlake.dll",
                        "bytes":  1049600
                    },
                    {
                        "sha256":  "d8f5c56ea490394eeae8b271650f2647aecd039a542d6df9e0140726e62a4603",
                        "file":  "ggml-cpu-alderlake.dll",
                        "bytes":  1009664
                    },
                    {
                        "sha256":  "b2296d8f44a7bffc1068c806d741aa3e59def2de1a86d3f8d7c2ce4fc8750377",
                        "file":  "parakeet-quantize.exe",
                        "bytes":  102912
                    },
                    {
                        "sha256":  "f7bdb50afd1c31a959eadf816a04878f8248c63973c027a64053346865091300",
                        "file":  "parakeet-cli.exe",
                        "bytes":  372224
                    },
                    {
                        "sha256":  "abe7399d64a67b1ebcb8d33becd07c67cbf186cb0d2bab34a4264feefdc337c4",
                        "file":  "parakeet.dll",
                        "bytes":  582144
                    },
                    {
                        "sha256":  "280f9f0f6015df40380fbde07f1b32614547a9122e61f7f49bb090ea72474f76",
                        "file":  "stream.exe",
                        "bytes":  27648
                    },
                    {
                        "sha256":  "de23db1694a3c7a4a735e7ecd3d214b2023cc2267922c6c35d30c7fc7370d677",
                        "file":  "SDL2.dll",
                        "bytes":  2500096
                    },
                    {
                        "sha256":  "4b4b05caba40d4309b5d710ef74c59ba190516b8489f27bdb1ba11ae33c6e9d3",
                        "file":  "ggml-cpu-x64.dll",
                        "bytes":  866816
                    },
                    {
                        "sha256":  "f060318772c4c2dbac312bbfff6ea700b85dbc502bb38585a7186d06d549301a",
                        "file":  "ggml-cpu-sse42.dll",
                        "bytes":  862720
                    },
                    {
                        "sha256":  "31fe18616d872af9b6134b47a6dff8072ae4ecbe5df0273f4f8dc36766c9db8e",
                        "file":  "ggml.dll",
                        "bytes":  62464
                    },
                    {
                        "sha256":  "ebf6211d1dbcbcf71a1222bcf1846b638540a32630e1d691b4114a272ba4c5db",
                        "file":  "main.exe",
                        "bytes":  27648
                    },
                    {
                        "sha256":  "74b7857b05951c0dff4c7baf796205433c84ee40c9bbb0bda3f182d4425ce339",
                        "file":  "llama.dll",
                        "bytes":  2755072
                    }
                ]
}
