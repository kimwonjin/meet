import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';

interface ReviewSheetProps {
  visible: boolean;
  partnerName?: string;
  onClose: () => void;
  onSubmit: (rating: number, content: string) => Promise<void>;
}

// 매칭을 마친 회원이 자기 파트너에게 남기는 후기 (별점 + 한 줄 후기)
export default function ReviewSheet({ visible, partnerName, onClose, onSubmit }: ReviewSheetProps) {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setRating(0);
      setContent('');
    }
  }, [visible]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(rating, content);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="파트너 후기 남기기">
      <Text style={styles.label}>{partnerName ? `${partnerName}의 도움은 어떠셨나요?` : '파트너의 도움은 어떠셨나요?'}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)} style={styles.starBtn} accessibilityLabel={`별 ${n}개`}>
            <Text style={[styles.star, n <= rating && styles.starOn]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="다른 회원에게 도움이 될 한마디를 남겨주세요 (선택)"
        placeholderTextColor="#999"
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={200}
      />
      <Text style={styles.hint}>후기는 이름 첫 글자만 표시돼요 (예: 김**)</Text>
      <TouchableOpacity
        style={[styles.submit, (rating === 0 || submitting) && styles.disabled]}
        disabled={rating === 0 || submitting}
        onPress={handleSubmit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{rating === 0 ? '별점을 선택해주세요' : '후기 등록하기'}</Text>}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: '#222', marginBottom: 12 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: 16 },
  starBtn: { padding: 6 },
  star: { fontSize: 36, color: '#DDD' },
  starOn: { color: '#5B21FF' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#222',
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: '#999', marginTop: 8, marginBottom: 16 },
  submit: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
