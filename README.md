# Testnet Toolkit API — Vercel port

Port dari build Cloudflare Worker (`../src/index.js`, RUN 27) ke
**Vercel Hobby (Edge Functions)**. Keputusan Muy 14 Nov 14:19 WIB:
"Pake saja kita hanya kejar task poin" — target hanya +500 poin quest
vAPI "List your API", bukan pemasukan jangka panjang.

## Kenapa Vercel (dan kenapa bukan Cloudflare)

- Signup Cloudflare mentok di Turnstile dari VM ini (browser runtime 5x
  reset + Chrome headed 9333 klik tidak bereaksi; dugaan IP egress
  ter-flag). Lihat RUN 28 di `../REPORT.md`.
- Vercel Hobby: **$0, tanpa kartu kredit, signup via GitHub**
  (sesi GitHub `duryanagy-wq` aktif di browser runtime), serverless —
  **tidak tidur** (bangun per request), 1 jt edge request/bulan
  (pemakaian kita ~1 rb/bulan: recheck vAPI per jam + probe).
- **Risiko yang diterima Muy:** fair-use Hobby membatasi ke
  "non-commercial, personal use only" — API ini berbayar ($0,001/call,
  payTo wallet agent) sehingga secara klausul masuk area komersial.
  Risiko ini disadari dan diterima karena target hanya poin quest:
  quest selesai saat listing LIVE; bila Vercel suatu hari menandai
  deployment ini, listing bisa suspend — tapi **+500 poinnya sudah
  didapat** (quest tidak ditarik kembali). Jangan jadikan ini jalur
  pemasukan jangka panjang tanpa pindah ke Pro ($20/bln) atau hosting
  lain.

## Struktur folder (isi repo GitHub — upload folder ini ke ROOT repo)

```
api/
  index.js            # GET /api — info layanan (gratis)
  openapi.json.js     # GET /api/openapi.json — dokumen OpenAPI (gratis)
  v1/
    gas.js            # GET /api/v1/gas (berbayar)
    balance.js        # GET /api/v1/balance (berbayar)
    faucets.js        # GET /api/v1/faucets (berbayar)
lib/
  handler.js          # SELURUH logika (salinan src/index.js, path di-/api/...)
openapi.json          # Dokumen OpenAPI standalone (== yang diserve handler)
package.json          # type: module; scripts test/dev
test/
  harness.mjs         # Harness verifikasi lokal (119 cek)
  serve.mjs           # Server HTTP localhost untuk `vapi check`
```

## Desain port (yang berubah vs Worker)

- **Runtime Edge** (`export const config = { runtime: "edge" }`) —
  API Web Request/Response yang sama dengan Workers, jadi `lib/handler.js`
  adalah salinan `src/index.js` dengan hanya path yang berubah.
- **Semua path publik di bawah `/api/...`** — tanpa `vercel.json`
  rewrite. Alasannya: rewrite akan mengubah `request.url` yang dilihat
  function, sehingga `resource.url` di offer x402 tidak cocok dengan URL
  yang dipanggil probe vAPI. Dengan path `/api/...` langsung, URL di
  offer selalu sama dengan URL yang diminta.
- **Satu sumber kebenaran OpenAPI:** `openapi.json` (file) HARUS sama
  persis dengan konstanta `OPENAPI` di `lib/handler.js` (harness mengecek
  ini). Bila mengedit salah satu, edit keduanya.
- **Harga + payout TIDAK berubah:** $0,001/call (1000 atomic USDC),
  payTo wallet agent `0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C`, USDC
  kanonis Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  (eip155:8453), skema `exact`, maxTimeoutSeconds 120.
- `servers.url` masih **placeholder** `https://testnet-toolkit.vercel.app`
  — ganti ke URL proyek asli bila nama proyek berbeda (lihat langkah A3).

## Verifikasi lokal (sudah dilakukan RUN 29 — 14 Nov 2026)

```bash
cd vercel
NODE_USE_ENV_PROXY=1 node test/harness.mjs   # 119 passed, 0 failed
NODE_USE_ENV_PROXY=1 node test/serve.mjs 8787  # lalu, di terminal lain:
# vapi check (grader resmi CLI v0.13.0, via runner proxy-aware):
#   node ../../vapi-cli/run-cli23.mjs check "http://localhost:8787/api/v1/gas?chain=sepolia"
# Hasil per endpoint: 9 passed, 2 warnings, 0 failed
# (warning: bazaar_metadata_missing + discovery_missing — keduanya opsional)
```

Satu jalur BELUM teruji lokal (disengaja): sukses berbayar (payment valid
→ facilitator verify+settle → data 200). Tidak bisa diuji tanpa
pembayaran nyata $0,001 — dan aturan keras melarang bayar. Jalur ini
teruji otomatis saat aktivasi pasca-deploy (probe vAPI melakukan paid
call sungguhan + konfirmasi payout sebelum listing live).

## Deploy — langkah PERSIS

### A. Repo GitHub (langkah parent — browser task, sesi GitHub `duryanagy-wq` aktif)

1. `github.com/new` → Repository name: `testnet-toolkit-vercel`,
   Public, tanpa README. Create.
2. Upload **ISI folder `vercel/` ini ke ROOT repo** (bukan folder
   `vercel/` itu sendiri): `api/`, `lib/`, `openapi.json`,
   `package.json` (plus `test/` + `README.md` ini). Via GitHub web
   upload (Add file → Upload files), atau `git push` bila kredensial
   tersedia di VM.
3. **PENTING sebelum import:** nama proyek Vercel menentukan URL.
   Default yang dipakai di kode: **`testnet-toolkit`** →
   `https://testnet-toolkit.vercel.app`. Bila nama itu sudah dipakai
   orang lain, Vercel menolak/menawarkan nama lain — bila nama proyek
   akhirnya BERBEDA, ganti `servers.url` di `lib/handler.js` (konstanta
   OPENAPI) DAN di `openapi.json` ke URL asli, jalankan ulang harness
   (harus tetap 119/119), lalu upload ulang ke GitHub sebelum import.

### B. Akun + import Vercel (langkah parent — browser task)

1. `vercel.com` → Sign Up → **"Continue with GitHub"** (tanpa kartu
   kredit — Hobby $0).
2. Add New → Project → Import Git Repository → pilih
   `testnet-toolkit-vercel`.
3. Configure: Framework Preset = **"Other"**, Root Directory = `./`,
   Build Command = kosong, Output Directory = kosong, Install
   Command = kosong, Environment Variables = tidak ada. (Tidak ada
   build step — Edge Functions langsung dari file.)
4. Deploy → tunggu "Congratulations". Catat Production URL:
   `https://<project>.vercel.app`.
5. Verifikasi di browser: `https://<project>.vercel.app/api` → 200
   (info); `https://<project>.vercel.app/api/v1/gas?chain=sepolia` →
   402 + header `PAYMENT-REQUIRED`.

### C. Verifikasi + publish + aktivasi (langkah parent/agent — CLI di VM, tanpa browser)

```bash
cd ~/workspace/user/farming/vapi-2026-11-08/vapi-cli
# 1. vapi check terhadap URL publik (target: 9 passed, 2 warnings, 0 failed):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<project>.vercel.app/api/v1/gas?chain=sepolia"
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<project>.vercel.app/api/v1/balance?chain=base-sepolia&address=0x0F4D4e842fd210380D57C6D5cef204D4F75f6121"
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<project>.vercel.app/api/v1/faucets?chain=sepolia"
# 2. Publish (mode openapi; catat slug yang dikembalikan):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs publish "https://<project>.vercel.app/api/openapi.json" --mode openapi --select gas,balance,faucets --name "Testnet Toolkit" --description "Live testnet gas prices, ETH balances and a verified faucet directory for Sepolia and Base Sepolia." --category data
#    Bila --select menolak nama gas,balance,faucets, coba operationId: getGas,getBalance,getFaucets.
# 3. Aktivasi (listing LIVE → quest selesai +500 poin):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs publish activate <slug>
# 4. Verifikasi quest "List your API" selesai di halaman Earn vAPI.
```

Catatan aktivasi: probe vAPI melakukan **paid call sungguhan**
($0,001) untuk konfirmasi payout — itu bagian dari alur aktivasi,
bukan pembayaran dari kita.

## Bila `api/openapi.json.js` ditolak Vercel

Nama file dengan dua titik (`openapi.json.js` → route
`/api/openapi.json`) adalah pola Vercel yang dikenal (mis. pola
`sitemap.xml.js`). Bila import/deploy menolaknya, fallback: hapus
file itu, taruh `openapi.json` sebagai file statis di `public/`
(route `/openapi.json`), dan ubah `openapi:` di info response +
langkah publish ke URL `/openapi.json`.
