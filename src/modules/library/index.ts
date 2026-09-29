// Public surface of the library module (Story 4.5): search today; projects,
// Sections and files move here from src/services over time.
export { reindexSearch, searchFiles, searchFolders, syncSearch, syncSearchLater } from './search.ts';
export { SEARCH_LIMIT, SEARCH_MAX_CANDIDATES, escapeLike, normalizeQuery, wildcardPattern } from './searchQuery.ts';
