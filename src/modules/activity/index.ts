// Public surface of the activity module: the project chat line and the
// notification row that domain modules (upload, share, projects) write when
// something happens. Readers and the GraphQL surface stay in src/services.
export { createNotification } from './notifications';
export type { NotifType } from './notifications';
export { insertChat } from './chat';
export type { ChatInput } from './chat';
