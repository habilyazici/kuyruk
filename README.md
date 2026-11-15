# Kuyruk Kronometresi

Kuyruk gözlemi için veri toplama aracı. Müşterinin geliş, hizmete başlama ve bitiş anlarını tek dokunuşla kaydeder, sonucu Excel dosyası olarak verir. Benzetim (simülasyon) derslerinde kâğıt ve kronometre yerine kullanılmak üzere hazırlandı.

**Adres:** https://kuyruk-kronometresi.web.app

## Özellikler

- Kurulum yok; telefonda ya da bilgisayarda tarayıcıdan açılır.
- Tek dokunuşla kayıt, geri alma ve yanlış kaydı silme.
- En çok üç aşama ve dört müşteri tipi. Her aşamada görevli sayısı ve sıra kuralı (FIFO, LIFO, serbest) ayarlanır.
- Excel çıktısı: geliş saati, gelişler arası süre, bekleme ve hizmet süreleri. Sütunlar seçilebilir ve yeniden adlandırılabilir.
- Kayıtlar cihazda saklanır. İsteyen Google hesabıyla giriş yapar; kayıtları hesabında da durur ve başka cihazda açılır.

## Kullanım

1. Müşteri gelince **+** düğmesine dokunun.
2. Hizmet bitince hizmetteki karta dokunun; sıradaki müşteri kendiliğinden başlar.
3. Gözlem bitince yeşil düğmeyle Excel dosyasını alın.

Ayarlar ve uygulamanın varsayımları menüdedir.

## Proje yapısı

```
public/               Yayınlanan site
  index.html          Sayfa
  styles.css          Görünüm
  js/app.js           Uygulama: durum, ekran, ayarlar, eşitleme
  js/excel.js         Excel (.xlsx) üretimi
  js/firebase.js      Google ile giriş ve hesapta saklama
  js/config.js        Firebase proje ayarı
firestore.rules       Veritabanı güvenlik kuralları
firebase.json         Yayın ayarı
```

Derleme adımı ve bağımlılık yoktur; dosyalar olduğu gibi yayınlanır.

## Geliştirme

Yerelde denemek için:

```
python3 -m http.server --directory public 8000
```

Sonra tarayıcıda `http://localhost:8000` adresini açın.

## Yayınlama

Site Firebase Hosting üzerindedir:

```
firebase deploy --only hosting
```

Güvenlik kuralları değiştiyse:

```
firebase deploy --only firestore:rules
```

## Kendi Firebase projenizle kullanmak

1. Bir Firebase projesi açın, Authentication'da Google ile girişi etkinleştirin ve bir Firestore veritabanı oluşturun.
2. `firestore.rules` dosyasındaki kuralları yükleyin.
3. `public/js/config.js` içindeki ayarı kendi projenizinkiyle, `.firebaserc` içindeki proje adını kendinizinkiyle değiştirin.

Girişi istemiyorsanız `config.js` içinde `apiKey` değerini boş bırakın; uygulama yalnızca cihazda saklayarak çalışır.

## Lisans

[MIT](LICENSE)
