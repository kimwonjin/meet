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

// 프로필 사진 최대 3장. 첫 번째가 대표 사진이며, 다른 사진을 누르면 대표로 바뀐다.
// 변경 즉시 저장한다 (프로필 저장 버튼과 별개).
export default function PhotoEditor({ userId, photos, onChange }: PhotoEditorProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);

  async function update(next: string[]) {
    await savePhotoUrls(userId, next);
    onChange(next);
  }

  async function handleAdd() {
    setUploading(true);
    try {
      const url = await pickAndUploadPhoto(userId);
      if (!url) return;
      await update([...photos, url]);
      toast.show('사진을 추가했습니다', 'success');
    } catch (error) {
      console.error('Photo upload error:', error);
      toast.show(error instanceof Error && error.message.includes('권한') ? error.message : '사진을 올리지 못했습니다. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(url: string) {
    if (!(await confirm({ title: '사진을 삭제할까요?', confirmText: '삭제', destructive: true }))) return;
    try {
      await update(photos.filter((p) => p !== url));
      deletePhoto(url);
    } catch (error) {
      toast.show('사진을 삭제하지 못했습니다', 'error');
    }
  }

  async function handleMakeMain(url: string) {
    try {
      await update([url, ...photos.filter((p) => p !== url)]);
      toast.show('대표 사진을 바꿨습니다', 'success');
    } catch (error) {
      toast.show('대표 사진을 바꾸지 못했습니다', 'error');
    }
  }

  const slots = Array.from({ length: MAX_PHOTOS }, (_, i) => photos[i] ?? null);
  const nextEmpty = photos.length;

  return (
    <View>
      <View style={styles.row}>
        {slots.map((url, i) =>
          url ? (
            <View key={url} style={styles.slot}>
              <TouchableOpacity style={styles.fill} disabled={i === 0} onPress={() => handleMakeMain(url)}>
                <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
              </TouchableOpacity>
              {i === 0 && (
                <View style={styles.mainBadge}>
                  <Text style={styles.mainBadgeText}>대표</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(url)} accessibilityLabel="사진 삭제">
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              key={`empty-${i}`}
              style={[styles.slot, styles.emptySlot]}
              disabled={uploading || i !== nextEmpty}
              onPress={handleAdd}
            >
              {uploading && i === nextEmpty ? (
                <ActivityIndicator color="#5B21FF" />
              ) : (
                <Text style={[styles.plus, i !== nextEmpty && styles.plusDisabled]}>+</Text>
              )}
            </TouchableOpacity>
          )
        )}
      </View>
      <Text style={styles.hint}>
        {photos.length === 0
          ? '얼굴이 잘 보이는 사진을 올려주세요. 매칭 상대와 파트너에게 보여요.'
          : '사진을 누르면 대표 사진으로 바뀌어요'}
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
  plusDisabled: {
    color: '#ddd',
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
