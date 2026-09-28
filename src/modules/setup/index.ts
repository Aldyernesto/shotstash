// Public surface of the setup module (Story 2.6).
export {
  SetupError,
  completeSetup,
  isSetupComplete,
  probeStorage,
} from './service';
export type { StorageProbe } from './service';
export { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, setupTokenMatches, setupTokenRequired, validateSetupInput } from './validate';
export type { SetupField, SetupInput, SetupValidation } from './validate';
