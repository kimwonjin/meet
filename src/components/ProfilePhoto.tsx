import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { shownPhotos } from '@/lib/photos';
import ProtectedPhoto from './ProtectedPhoto';

// 동그란 대표 사진. 사진이 없으면 기본 아이콘을 보여준다.
export function Avatar({ photoUrls, size = 44 }: { photoUrls?: string[] | null; size?: number }) {
  const url = shownPhotos(photoUrls)[0];
  const box = { width: size, height: size, borderRadius: size / 2 };
  return url ? (
    <Image source={{ uri: url }} style={[styles.avatar, box]} contentFit="cover" />
  ) : (
    <View style={[styles.avatar, styles.placeholder, box]}>
      <Text style={{ fontSize: size * 0.45 }}>👤</Text>
    </View>
  );
}

// 프로필 시트용 사진 목록. 좌우로 넘기지 않고 세로로 나열한다.
export function PhotoList({ photoUrls: raw }: { photoUrls?: string[] | null }) {
  const photoUrls = shownPhotos(raw);
  if (!photoUrls.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>등록된 사진이 없습니다</Text>
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {photoUrls.map((url) => (
        <ProtectedPhoto key={url} uri={url} style={styles.photo} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#F1ECFF',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    gap: 8,
    marginBottom: 16,
  },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: '#F1ECFF',
  },
  empty: {
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: '#F8F6FB',
    borderRadius: 12,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 13,
    color: '#98959E',
  },
});
