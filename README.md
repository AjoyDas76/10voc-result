# ১০ম শ্রেণি Result Portal (প্রাক-নির্বাচনি পরীক্ষা)

এই রিপোতে ১০ম শ্রেণি (ভোকেশনাল)-এর **প্রাক-নির্বাচনি পরীক্ষা-২০২৬**-এর ফলাফল প্রকাশের জন্য সম্পূর্ণ রেডি ফাইল আছে।

## ফাইল কাঠামো

```
index.html     → মূল পেজ (এডিট করার দরকার নেই)
style.css      → ডিজাইন (এডিট করার দরকার নেই)
script.js      → লজিক / GPA হিসাব (এডিট করার দরকার নেই)
results.json   → ⭐ প্রাক-নির্বাচনি পরীক্ষার ৪৪ জন শিক্ষার্থীর রেজাল্ট (এখানেই ডেটা)
logo.png       → স্কুলের লোগো (প্রবর্তক স্কুল এন্ড কলেজ)
excel_to_json.py → পরবর্তী পরীক্ষার Excel থেকে results.json বানানোর স্ক্রিপ্ট
```

## GitHub Pages-এ হোস্ট করবেন কীভাবে

1. এই ৬টা ফাইল (`index.html`, `style.css`, `script.js`, `results.json`, `logo.png`, `excel_to_json.py`) আপনার নতুন repository-র **রুট ফোল্ডারে** আপলোড করুন (কোনো সাব-ফোল্ডারে না)।
2. Repository-এর **Settings → Pages**-এ যান।
3. **Source: Deploy from a branch**, **Branch: main**, **Folder: / (root)** সিলেক্ট করে **Save** করুন।
4. ১-৩ মিনিট পর ঐ পেজেই উপরে একটা সবুজ ব্যানারে লিংক আসবে — যেমন `https://your-username.github.io/repo-name/`।
5. লিংকটা রিফ্রেশ (দরকার হলে Ctrl+Shift+R) করে ২-১ জনের Roll Number দিয়ে সার্চ করে পরীক্ষা করে দেখুন।

## যাচাই করার জন্য নমুনা তথ্য

- মোট শিক্ষার্থী: ৪৪ জন, Roll `01` থেকে শুরু
- Roll `01` = Pranti Shil (H)
- Roll `04` = Srabonti Roy

## পরবর্তী পরীক্ষার রেজাল্ট প্রকাশ করবেন কীভাবে

নতুন পরীক্ষার Excel ফাইল (একই ফরম্যাটে, মোট নম্বর/প্রাপ্ত নম্বর/গ্রেড কলাম-সহ) পূরণ করে আমাকে দিলে আমি নতুন `results.json` বানিয়ে দেব, অথবা নিজে কমান্ড চালাতে পারেন:

```bash
python3 excel_to_json.py নতুন_মার্কশিট.xlsx results.json \
  --sheet pretest \
  --exam-name "পরীক্ষার নাম-২০২৬" \
  --exam-class "১০ম" --section "ভোকেশনাল"
```

⚠️ **নোট:** যদি নতুন Excel ফাইলে Roll Number কলাম না থাকে, `--roll-file` ও `--roll-sheet` দিয়ে একটা Roll-list শিট বসিয়ে দিতে হবে (রোল ও নাম একই ক্রমে থাকতে হবে)। প্রশ্ন থাকলে আমাকে জানাবেন।

নতুন `results.json` বানানোর পর সেটা GitHub-এ **Upload files → same name → Commit** করে replace করলেই নতুন রেজাল্ট লাইভ হয়ে যাবে। বাকি ফাইল (`index.html`, `style.css`, `script.js`, `logo.png`) কখনো ছোঁয়া লাগবে না।
