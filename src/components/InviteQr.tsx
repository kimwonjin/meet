import { adFooter } from '@/lib/business';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useToast } from '@/contexts/ToastContext';

// 초대 링크 QR. 화면에 그리고, 웹에서는 PNG로 저장할 수 있다 (서버에 저장하지 않음).
// QR 라이브러리는 이 화면을 열 때만 불러온다 (첫 화면 속도)
const loadQr = () => import('qrcode').then((m: any) => m.default || m);
export default function InviteQr({ url, fileName }: { url: string; fileName: string }) {
  const toast = useToast();
  const [svg, setSvg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadQr()
      .then((QRCode) => QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#1D1A26', light: '#FFFFFF' } }))
      .then((s: string) => alive && setSvg('data:image/svg+xml;utf8,' + encodeURIComponent(s)))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [url]);

  async function downloadPng() {
    if (saving) return;
    setSaving(true);
    try {
      const QRCode = await loadQr();
      const qrUrl: string = await QRCode.toDataURL(url, { width: 1024, margin: 2, color: { dark: '#1D1A26', light: '#FFFFFF' } });
      // QR 아래에 상호·결혼중개업 신고번호를 넣어 저장한다 (광고에 신고번호 포함, 결혼중개업법 제12조 ③)
      const img = document.createElement('img');
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = qrUrl; });
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 1024 + 110;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, 1024, 1024);
      ctx.fillStyle = '#322F38'; ctx.textAlign = 'center'; ctx.font = '600 34px sans-serif';
      ctx.fillText(adFooter(), 512, 1024 + 62, 980);
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${fileName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.show('QR 이미지를 저장했어요', 'success');
    } catch {
      toast.show('QR 이미지를 저장하지 못했어요', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.box} accessibilityLabel="초대 링크 QR 코드">
        {svg === null ? (
          <ActivityIndicator color="#5B21FF" />
        ) : svg ? (
          <Image source={{ uri: svg }} style={styles.qr} contentFit="contain" />
        ) : (
          <Text style={styles.fail}>QR을 만들지 못했어요</Text>
        )}
      </View>
      <Text style={styles.adLine}>{adFooter()}</Text>
      <Text style={styles.help}>모임 공지·명함·전단에 넣으면, 휴대폰 카메라로 찍어서 바로 들어올 수 있어요.</Text>
      {Platform.OS === 'web' ? (
        <TouchableOpacity style={styles.btn} onPress={downloadPng} disabled={saving || !svg}>
          {saving ? <ActivityIndicator color="#5B21FF" /> : <Text style={styles.btnText}>QR 이미지 저장 (PNG)</Text>}
        </TouchableOpacity>
      ) : (
        <Text style={styles.help}>이 화면을 캡처해서 저장해 주세요.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  adLine: { fontSize: 12, color: '#54515A', textAlign: 'center', marginTop: 6 },
  wrap: { alignItems: 'center', gap: 10 },
  box: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#EDEBF0', padding: 10 },
  qr: { width: 180, height: 180 },
  fail: { fontSize: 13, color: '#736F7A' },
  help: { fontSize: 12, color: '#6E6A75', textAlign: 'center', lineHeight: 18 },
  btn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, minWidth: 180, alignItems: 'center' },
  btnText: { color: '#5B21FF', fontSize: 14, fontWeight: '600' },
});
