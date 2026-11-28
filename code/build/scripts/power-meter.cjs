'use strict';

// Never substitute a DRAM, GPU, or other meter when package power is absent.
const DEFAULT_PACKAGE_INSTANCE = 'rapl_package0_pkg';
function packageInstance(value = DEFAULT_PACKAGE_INSTANCE) {
  if (typeof value !== 'string' || !/^rapl_package[0-9]+_pkg$/i.test(value)) {
    throw new Error('Expected an explicit CPU package RAPL meter, e.g. rapl_package0_pkg');
  }
  return value.toLowerCase();
}
function verifiesPackageSample(sample, instance) {
  try {
    const chosen = packageInstance(instance);
    return typeof instance === 'string' &&
      sample?.instance?.toLowerCase() === chosen &&
      sample?.counter?.toLowerCase() === '\\energy meter(' + chosen + ')\\power' &&
      sample?.unit === 'mW' && Number.isFinite(sample.medianMW) && sample.medianMW > 0 &&
      Number.isInteger(sample.sampleCount) && sample.sampleCount >= 3;
  } catch { return false; }
}
function requirePackageSample(sample, instance) {
  if (!verifiesPackageSample(sample, instance)) throw new Error('CPU package power meter missing or inconsistent: ' + instance);
  return sample;
}
module.exports = { packageInstance, verifiesPackageSample, requirePackageSample };
