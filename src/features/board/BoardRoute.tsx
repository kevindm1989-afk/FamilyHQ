/**
 * Bulletin Board route — wires the screen to live data. The feed comes from
 * useFamilyPosts(familyId) (the only query the rules allow); create/delete are
 * the boardService actions bound to the real Firestore. The screen itself
 * derives the author crown from the live member list and toasts every action.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { BoardScreen } from './BoardScreen';
import { useFamilyPosts } from './useFamilyPosts';
import { createPost, deletePost, type CreatePostInput } from './boardService';

export default function BoardRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyPosts(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Board" />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
  };

  // Firebase config is imported lazily (mirrors useFamily / useFamilyPosts) so
  // the shell module stays SDK-free at the top level.
  const handleDelete = async (postId: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    await deletePost({ db }, postId);
  };
  const handleCreate = async (content: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    const input: CreatePostInput = {
      content,
      authorId: viewer.uid,
      authorName: viewer.name,
      familyId,
    };
    await createPost({ db }, input);
  };

  return (
    <BoardScreen
      familyId={familyId}
      viewer={viewer}
      members={members}
      feed={feed}
      onDeletePost={handleDelete}
      onCreatePost={handleCreate}
    />
  );
}
