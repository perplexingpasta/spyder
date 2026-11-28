import { contextBridge, ipcRenderer } from 'electron';
import type { SpyderApi } from './api';

const invoke =
  (method: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`spyder:${method}`, ...args);

const on = (channel: string) => (cb: (v: unknown) => void) => {
  const fn = (_e: unknown, v: unknown) => cb(v);
  ipcRenderer.on(`spyder:${channel}`, fn);
  return () => ipcRenderer.removeListener(`spyder:${channel}`, fn);
};

const methods = [
  'getSettings', 'setSettings', 'getWidget', 'start', 'stop', 'setBlockLength', 'dismissReminder', 'keepWorking',
  'answerBlocks', 'answerSuggestions', 'deleteBlocks', 'mergeBlocks', 'mergeRepeats', 'unmergeBlock', 'fillUntracked', 'tagBlocks', 'rateBlocks', 'undoEdit', 'getPrompt', 'saveReflection',
  'hideWidget', 'minimizeWidget', 'openDashboard', 'resizePrompt',
  'getDay', 'saveRule', 'getReview', 'saveReviewItem', 'deleteReviewItem', 'completeReview', 'listKpis', 'saveKpi',
  'setKpiValue', 'showWidget',
  'getRange', 'listToAsk', 'appIcons', 'listRules', 'deleteRule', 'listTitlePatterns', 'saveTitlePattern', 'deleteTitlePattern',
  'getSchedule', 'setSchedule', 'setDayOverride', 'openDataFolder', 'exportData', 'showInFolder',
  'getGadget', 'addGadgetRow', 'editGadgetRow', 'clearTicked', 'gadgetImportList', 'importGadgetRows', 'minimizeGadget',
] as const;

const debugNames = ['state', 'setNow', 'advance', 'setScale', 'tick', 'simulateIdle', 'simulateSuspend',
  'simulateResume', 'simulateLock', 'simulateUnlock', 'injectActivity', 'trayInfo', 'trayClick', 'flush', 'killProbe', 'triggerHotkey', 'rememberAppPath'] as const;

const api = {
  ...Object.fromEntries(methods.map((m) => [m, invoke(m)])),
  onWidget: on('widget'),
  onPrompt: on('prompt'),
  onGadget: on('gadget'),
  debug:
    process.env.SPYDER_DEBUG === '1'
      ? Object.fromEntries(
          debugNames.map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke('spyder:debug', n, ...args)]),
        )
      : undefined,
} as unknown as SpyderApi;

contextBridge.exposeInMainWorld('spyder', api);
