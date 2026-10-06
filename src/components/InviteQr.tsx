import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import QRCode from 'qrcode';
import { useToast } from '@/contexts/ToastContext';

// 초대 링크 QR. 화면에 그리고, 웹에서는 PNG로 저장할 수 있다 (서버에 저장하지 않음).
export default function InviteQr({ url, fileName }: { url: string; fileName: string }) {
  const toast = useToast();
  const [svg, setSvg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#1D1A26', light: '#FFFFFF' } })
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
      const dataUrl: string = await QRCode.toDataURL(url, { width: 1024, margin: 2, color: { dark: '#1D1A26', light: '#FFFFFF' } });
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
  wrap: { alignItems: 'center', gap: 10 },
  box: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee', padding: 10 },
  qr: { width: 180, height: 180 },
  fail: { fontSize: 13, color: '#999' },
  help: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 18 },
  btn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, minWidth: 180, alignItems: 'center' },
  btnText: { color: '#5B21FF', fontSize: 14, fontWeight: '600' },
});
