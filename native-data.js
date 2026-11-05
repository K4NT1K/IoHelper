import {startNativeDataClient} from './modules/native/Client.js';
window.__iohNativeData = startNativeDataClient({window, chrome});
