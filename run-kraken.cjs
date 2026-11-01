// Ejecuta kraken-node con tres ajustes a su funcionamiento interno (requiere kraken-node 1.0.24):
// 1. Sin adb (Android SDK), ejecuta los escenarios web en lugar de detenerse.
// 2. Crea los archivos de señales sin vaciarlos, para que dos usuarios que escriben al mismo tiempo
//    no borren el mensaje del otro.
// 3. Ejecuta todos los archivos .feature y espera a que cada usuario escriba su reporte antes de
//    terminar.
// Uso: node run-kraken.cjs run
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");

function createFilesWithoutTruncating() {
  const { FileHelper } = require("kraken-node/lib/utils/FileHelper");
  FileHelper.prototype.createFileIfDoesNotExist = function (path) {
    fs.closeSync(fs.openSync(path, "a"));
  };
}

function adbAvailable() {
  try {
    execFileSync("adb", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runWithoutAndroidDevices() {
  const { TestScenario } = require("kraken-node/lib/TestScenario");
  TestScenario.prototype.sampleMobileDevices = function () {
    if (this.featureFile.numberOfRequiredMobileDevices() > 0) {
      throw new Error("Este escenario tiene usuarios @mobile y no se encontró 'adb' (Android SDK).");
    }
    return [];
  };
}

function runEveryFeatureAndWaitForReports() {
  const { DeviceProcess } = require("kraken-node/lib/processes/DeviceProcess");
  const { TestScenario } = require("kraken-node/lib/TestScenario");
  const Constants = require("kraken-node/lib/utils/Constants");
  DeviceProcess.prototype.runWithArgs = async function (args) {
    const userProcess = spawn("node", args, { stdio: "inherit" });
    this.exited = new Promise((resolve) => {
      userProcess.on("exit", (code) => {
        if (code) process.exitCode = 1;
        resolve();
      });
    });
  };
  const afterExecute = TestScenario.prototype.afterExecute;
  TestScenario.prototype.afterExecute = async function () {
    await Promise.all(this.processes.map((userProcess) => userProcess.exited));
    const saveReport = this.reporter.saveReport.bind(this.reporter);
    this.reporter.saveReport = () => {
      try {
        fs.mkdirSync(`${Constants.REPORT_PATH}/${this.executionId}/assets/js`, { recursive: true });
        saveReport();
      } catch (error) {
        console.error(`Kraken no pudo generar el reporte HTML de ${this.executionId}: ${error.message}`);
      }
    };
    return afterExecute.call(this);
  };
}

function preloadInUserProcesses() {
  const { DeviceProcess } = require("kraken-node/lib/processes/DeviceProcess");
  const baseArgs = DeviceProcess.prototype.baseArgs;
  DeviceProcess.prototype.baseArgs = function () {
    return ["--require", __filename, ...baseArgs.call(this)];
  };
}

createFilesWithoutTruncating();

if (require.main === module) {
  if (!adbAvailable()) {
    runWithoutAndroidDevices();
  }
  preloadInUserProcesses();
  runEveryFeatureAndWaitForReports();
  require("kraken-node/bin/kraken-node");
}