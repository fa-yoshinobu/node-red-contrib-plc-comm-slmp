"use strict";

const FRAME_3E_REQUEST_SUBHEADER = Buffer.from([0x50, 0x00]);
const FRAME_3E_RESPONSE_SUBHEADER = Buffer.from([0xd0, 0x00]);
const FRAME_4E_REQUEST_SUBHEADER = Buffer.from([0x54, 0x00]);
const FRAME_4E_RESPONSE_SUBHEADER = Buffer.from([0xd4, 0x00]);

const FrameType = Object.freeze({
  FRAME_3E: "3e",
  FRAME_4E: "4e",
});

const PLCSeries = Object.freeze({
  QL: "ql",
  IQR: "iqr",
});

const DeviceUnit = Object.freeze({
  BIT: "bit",
  WORD: "word",
});

const ModuleIONo = Object.freeze({
  OWN_STATION: 0x03ff,
  CONTROL_CPU: 0x03ff,
  MULTIPLE_CPU_1: 0x03e0,
  MULTIPLE_CPU_2: 0x03e1,
  MULTIPLE_CPU_3: 0x03e2,
  MULTIPLE_CPU_4: 0x03e3,
  CONTROL_SYSTEM_CPU: 0x03d0,
  STANDBY_SYSTEM_CPU: 0x03d1,
  SYSTEM_A_CPU: 0x03d2,
  SYSTEM_B_CPU: 0x03d3,
  REMOTE_HEAD_1: 0x03e0,
  REMOTE_HEAD_2: 0x03e1,
  CONTROL_SYSTEM_REMOTE_HEAD: 0x03d0,
  STANDBY_SYSTEM_REMOTE_HEAD: 0x03d1,
});

const Command = Object.freeze({
  DEVICE_READ: 0x0401,
  DEVICE_WRITE: 0x1401,
  DEVICE_READ_RANDOM: 0x0403,
  DEVICE_WRITE_RANDOM: 0x1402,
  READ_TYPE_NAME: 0x0101,
});

const SUBCOMMAND_DEVICE_WORD_QL = 0x0000;
const SUBCOMMAND_DEVICE_BIT_QL = 0x0001;
const SUBCOMMAND_DEVICE_WORD_IQR = 0x0002;
const SUBCOMMAND_DEVICE_BIT_IQR = 0x0003;

const SUBCOMMAND_DEVICE_WORD_QL_EXT = 0x0080;
const SUBCOMMAND_DEVICE_BIT_QL_EXT = 0x0081;
const SUBCOMMAND_DEVICE_WORD_IQR_EXT = 0x0082;
const SUBCOMMAND_DEVICE_BIT_IQR_EXT = 0x0083;

const DEVICE_CODES = Object.freeze({
  SM: { code: 0x0091, radix: 10, unit: DeviceUnit.BIT },
  SD: { code: 0x00a9, radix: 10, unit: DeviceUnit.WORD },
  X: { code: 0x009c, radix: 16, unit: DeviceUnit.BIT },
  Y: { code: 0x009d, radix: 16, unit: DeviceUnit.BIT },
  M: { code: 0x0090, radix: 10, unit: DeviceUnit.BIT },
  L: { code: 0x0092, radix: 10, unit: DeviceUnit.BIT },
  F: { code: 0x0093, radix: 10, unit: DeviceUnit.BIT },
  V: { code: 0x0094, radix: 10, unit: DeviceUnit.BIT },
  B: { code: 0x00a0, radix: 16, unit: DeviceUnit.BIT },
  D: { code: 0x00a8, radix: 10, unit: DeviceUnit.WORD },
  W: { code: 0x00b4, radix: 16, unit: DeviceUnit.WORD },
  TS: { code: 0x00c1, radix: 10, unit: DeviceUnit.BIT },
  TC: { code: 0x00c0, radix: 10, unit: DeviceUnit.BIT },
  TN: { code: 0x00c2, radix: 10, unit: DeviceUnit.WORD },
  LTS: { code: 0x0051, radix: 10, unit: DeviceUnit.BIT },
  LTC: { code: 0x0050, radix: 10, unit: DeviceUnit.BIT },
  LTN: { code: 0x0052, radix: 10, unit: DeviceUnit.WORD },
  STS: { code: 0x00c7, radix: 10, unit: DeviceUnit.BIT },
  STC: { code: 0x00c6, radix: 10, unit: DeviceUnit.BIT },
  STN: { code: 0x00c8, radix: 10, unit: DeviceUnit.WORD },
  LSTS: { code: 0x0059, radix: 10, unit: DeviceUnit.BIT },
  LSTC: { code: 0x0058, radix: 10, unit: DeviceUnit.BIT },
  LSTN: { code: 0x005a, radix: 10, unit: DeviceUnit.WORD },
  CS: { code: 0x00c4, radix: 10, unit: DeviceUnit.BIT },
  CC: { code: 0x00c3, radix: 10, unit: DeviceUnit.BIT },
  CN: { code: 0x00c5, radix: 10, unit: DeviceUnit.WORD },
  LCS: { code: 0x0055, radix: 10, unit: DeviceUnit.BIT },
  LCC: { code: 0x0054, radix: 10, unit: DeviceUnit.BIT },
  LCN: { code: 0x0056, radix: 10, unit: DeviceUnit.WORD },
  SB: { code: 0x00a1, radix: 16, unit: DeviceUnit.BIT },
  SW: { code: 0x00b5, radix: 16, unit: DeviceUnit.WORD },
  DX: { code: 0x00a2, radix: 16, unit: DeviceUnit.BIT },
  DY: { code: 0x00a3, radix: 16, unit: DeviceUnit.BIT },
  Z: { code: 0x00cc, radix: 10, unit: DeviceUnit.WORD },
  LZ: { code: 0x0062, radix: 10, unit: DeviceUnit.WORD },
  R: { code: 0x00af, radix: 10, unit: DeviceUnit.WORD },
  ZR: { code: 0x00b0, radix: 10, unit: DeviceUnit.WORD },
  RD: { code: 0x002c, radix: 10, unit: DeviceUnit.WORD },
  G: { code: 0x00ab, radix: 10, unit: DeviceUnit.WORD },
  HG: { code: 0x002e, radix: 10, unit: DeviceUnit.WORD },
});

module.exports = {
  Command,
  DEVICE_CODES,
  DeviceUnit,
  FRAME_3E_REQUEST_SUBHEADER,
  FRAME_3E_RESPONSE_SUBHEADER,
  FRAME_4E_REQUEST_SUBHEADER,
  FRAME_4E_RESPONSE_SUBHEADER,
  FrameType,
  ModuleIONo,
  PLCSeries,
  SUBCOMMAND_DEVICE_BIT_IQR,
  SUBCOMMAND_DEVICE_BIT_IQR_EXT,
  SUBCOMMAND_DEVICE_BIT_QL,
  SUBCOMMAND_DEVICE_BIT_QL_EXT,
  SUBCOMMAND_DEVICE_WORD_IQR,
  SUBCOMMAND_DEVICE_WORD_IQR_EXT,
  SUBCOMMAND_DEVICE_WORD_QL,
  SUBCOMMAND_DEVICE_WORD_QL_EXT,
};

