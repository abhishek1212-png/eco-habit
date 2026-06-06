import { registerRootComponent } from 'expo';

// Use require to load App to avoid default-import interop issues during TS checks
const App = require('./App').default ?? require('./App');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

