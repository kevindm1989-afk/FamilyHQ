/**
 * Bulletin Board route — wires the screen to live data. The feed comes from
 * useFamilyPosts(familyId) (the only query the rules allow); create/delete are
 * the boardService actions bound to the real Firestore. The screen itself
 * derives the author crown from the live member list and toasts every action.
 *
 * Also handles the /board/new deep-link entry: AppShell routes both /board AND
 * /board/new to this component, and the route detects the path so a fresh
 * landing on /board/new opens the composer over a fully-rendered board.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { ROUTES } from '../../app/routes';
import { BoardScreen } from './BoardScreen';
import { useFamilyPosts } from './useFamilyPosts';
import { createPost, deletePost, type CreatePostInput } from './boardService';

export default function BoardRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyPosts(familyId);
  const location = useLocation();
  const navigate = useNavigate();

  // /board/new is a deep-link entry: it lands here AND opens the composer.
  // When the sheet closes we replace the URL with /board so the modal route
  // doesn't linger in browser history (back button should not re-open the
  // composer, it should go to wherever the user was before).
  const isComposeDeepLink = location.pathname === ROUTES.compose.path;

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

  const handleComposeClose = (): void => {
    if (isComposeDeepLink) {
      navigate(ROUTES.board.path, { replace: true });
    }
  };

  return (
    <BoardScreen
      familyId={familyId}
      viewer={viewer}
      members={members}
      feed={feed}
      onDeletePost={handleDelete}
      onCreatePost={handleCreate}
      initialComposeOpen={isComposeDeepLink}
      onComposeClose={handleComposeClose}
    />
  );
}
