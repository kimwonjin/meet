import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { MAX_PHOTOS, deletePhoto, pickAndUploadPhoto, savePhotoUrls } from '@/lib/photos';

interface PhotoEditorProps {
  userId: string;
  photos: string[];
  onChange: (photos: string[]) => void;
}

// 프로필 사진 최대 3장. 칸 자리는 고정이고 첫 칸이 대표 사진이다.
// 사진을 지우면 그 칸만 비고 나머지는 제자리에 남는다. 다른 사진을 누르면 대표 칸과 자리를 바꾼다.
// 변경 즉시 저장한다 (프로필 저장 버튼과 별개).
export default function PhotoEditor({ userId, photos, onChange }: PhotoEditorProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  async function update(next: string[]) {
    await savePhotoUrls(userId, next);
    onChange(next);
  }

  // 칸 i에 사진을 넣는다 (중간 빈 칸도 채울 수 있다)
  async function handleAdd(i: number) {
    setUploading(true);
    setUploadingSlot(i);
    try {
      const url = await pickAndUploadPhoto(userId);
      if (!url) return;
      const next = Array.from({ length: Math.max(photos.length, i + 1) }, (_, k) => photos[k] ?? '');
      next[i] = url;
      await update(next);
      toast.show('사진을 추가했습니다', 'success');
    } catch (error) {
      console.error('Photo upload error:', error);
      toast.show(error instanceof Error && error.message.includes('권한') ? error.message : '사진을 올리지 못했습니다. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setUploading(false);
      setUploadingSlot(null);
    }
  }

  async function handleRemove(i: number) {
    const url = photos[i];
    if (!url) return;
    if (!(await confirm({ title: i === 0 ? '대표 사진을 삭제할까요?' : '사진을 삭제할까요?', confirmText: '삭제', destructive: true }))) return;
    try {
      const next = [...photos];
      next[i] = '';
      await update(next);
      deletePhoto(url);
    } catch (error) {
      toast.show('사진을 삭제하지 못했습니다', 'error');
    }
  }

  // 누른 사진과 대표 칸의 자리를 바꾼다
  async function handleMakeMain(i: number) {
    try {
      const next = Array.from({ length: Math.max(photos.length, 1) }, (_, k) => photos[k] ?? '');
      [next[0], next[i]] = [next[i], next[0] ?? ''];
      await update(next);
      toast.show('대표 사진을 바꿨습니다', 'success');
    } catch (error) {
      toast.show('대표 사진을 바꾸지 못했습니다', 'error');
    }
  }

  const slots = Array.from({ length: MAX_PHOTOS }, (_, i) => photos[i] || null);
  const hasAny = photos.some(Boolean);

  return (
    <View>
      <View style={styles.row}>
        {slots.map((url, i) =>
          url ? (
            <View key={url} style={styles.slot}>
              <TouchableOpacity style={styles.fill} disabled={i === 0} onPress={() => handleMakeMain(i)}>
                <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
              </TouchableOpacity>
              {i === 0 && (
                <View style={styles.mainBadge}>
                  <Text style={styles.mainBadgeText}>대표</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(i)} accessibilityLabel="사진 삭제">
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              key={`empty-${i}`}
              style={[styles.slot, styles.emptySlot]}
              disabled={uploading}
              onPress={() => handleAdd(i)}
              accessibilityLabel={i === 0 ? '대표 사진 추가' : '사진 추가'}
            >
              {uploading && uploadingSlot === i ? (
                <ActivityIndicator color="#5B21FF" />
              ) : (
                <>
                  <Text style={styles.plus}>+</Text>
                  {i === 0 && <Text style={styles.emptyMainText}>대표 사진</Text>}
                </>
              )}
            </TouchableOpacity>
          )
        )}
      </View>
      <Text style={styles.hint}>
        {!hasAny
          ? '얼굴이 잘 보이는 사진을 올려주세요. 매칭 상대와 파트너에게 보여요.'
          : !photos[0]
            ? '대표 칸이 비어 있어요. 채우기 전까지는 다음 사진이 대표로 보여요.'
            : '사진을 누르면 대표 사진과 자리가 바뀌어요'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F1ECFF',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  emptySlot: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9F9F9',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderStyle: 'dashed',
  },
  plus: {
    fontSize: 28,
    color: '#5B21FF',
  },
  emptyMainText: {
    fontSize: 11,
    color: '#5B21FF',
    marginTop: 2,
    fontWeight: '600',
  },
  mainBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: '#5B21FF',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mainBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  removeBtn: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: {
    color: '#fff',
    fontSize: 13,
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
});
