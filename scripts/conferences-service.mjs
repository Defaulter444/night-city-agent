import { mutate } from './store.mjs';
import * as C from './conferences-model.mjs';
import { canReadDocument } from './documents-model.mjs';
import { imageIssue } from './images.mjs';

export async function runConferenceOperation(data, callerId) {
  const user = game.users.get(callerId);
  if (!user) throw Error('Пользователь не найден');
  return mutate(state => {
    switch (data.op) {
      case 'create': return C.createConference(state, data, user);
      case 'edit': return C.editConference(state, data, user);
      case 'leave': return C.leaveConference(state, data, user);
      case 'read': return C.markConferenceRead(state, data, user);
      case 'draft': {
        const room = C.requireParticipant(state, data.id, data.number, user);
        room.drafts[data.number] = String(data.text ?? '').slice(0, 2000); return true;
      }
      case 'send': {
        C.requireParticipant(state, data.id, data.number, user);
        if (data.image) { const issue = imageIssue(data.image); if (issue) throw Error(issue); }
        if (data.documentId) {
          const doc = state.documents?.[data.documentId];
          if (!canReadDocument(state, doc, user, user.viewedScene)) throw Error('Нет доступа к файлу');
          // Conference access follows membership; sharing never publishes to non-members.
        }
        return C.sendConference(state, data, user);
      }
      default: throw Error('Неизвестная операция конференции');
    }
  });
}
