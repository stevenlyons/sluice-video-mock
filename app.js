const Koa = require('koa');
const fs = require('fs');
const app = module.exports = new Koa();
const path = require('path');
const extname = path.extname;

// Segment length is 5 seconds
const segmentLength = 5;

// try GET /app.js

app.use(async ctx => {
    const filepath = path.dirname(ctx.path);
    const filename = path.basename(ctx.path);

    console.log(`none: path: ${filepath} name: ${filename}`);  

    if (shouldIgnoreRequest(filename)) return;
    
    const operations = parseSpec(filepath);

    switch (checkRequestType(filename)) {
      case 'media':
        console.log('Media request');

        // Choose number of renditions (currently hardcoded to 1 rendition)
        await generateMediaPlaylist(ctx, filepath, filename);
        break;
      case 'rendition':
        console.log('Rendition request');

        // generate rendition based on specification in request
        const mediaLength = calculateMediaLength(operations);
        await generateRendition(ctx, mediaLength);
        break;
      case 'segment':
        console.log('Segment request');

        // interpolate the file request, figure out the progress in the video session
        const time = calculateElapsedPlayheadTime(filename);
        const timeline = createSegmentTimeline(operations);

        // take appropriate action
        await processSegment(ctx, timeline, time);
        break;
      default:
        await outputFile(ctx, '/media', filename);
        break;
    }
});

if (!module.parent) app.listen(3000);

async function processSegment(ctx, timeline, time) {
  if (!timeline || time === undefined) return;

  const segmentNum = Math.ceil(time / segmentLength);
  const segment = timeline.find((el) => el.segment === segmentNum);
console.dir(segment);

  const filename = segmentNum > 0 ? '0.ts' : '0.ts';

  if (segment) {
    // Delayed playback for startup or rebuffer
    if (segment.delay > 0) {
      await sleep(segment.delay);
      await outputFile(ctx, '/media', filename);
    } 

    // Throw an Error
    if (segment.error > 0) {
      await outputError(ctx, segment.error);
    }
  } else {
    // Nominal playback
    await outputFile(ctx, '/media', filename);
  }
};

async function generateMediaPlaylist(ctx, filepath, filename) {
  await outputFile(ctx, '/media', filename);
}

async function generateRendition(ctx, medialength) {
  const start = 
`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD`;
  const end = `\n#EXT-X-ENDLIST`;
  var segments = '';

  for (let i = 0; i < medialength / 5; i++) {
    segments += '\n' + 
`#EXTINF:5,
${i}.ts`;
  }

  ctx.type = 'application/x-mpegURL'
  ctx.body = start + segments + end;
}

function calculateElapsedPlayheadTime(filename) {
  if (!filename) return;

  // Method:
  // Use the current segment request to figure out where in the rendition playlist
  // the player currently is. Each segment is 5sec and each segment is named in 
  // integer order so we can multiply those together.
  const currentSegment = path.basename(filename, path.extname(filename));
  if (Number.isNaN(parseInt(currentSegment))) return;

  return parseInt(currentSegment) * segmentLength;
}

function shouldIgnoreRequest(filename) {
  const ignore = ['favicon.ico', 'apple-touch-icon-precomposed.png', 'apple-touch-icon.png']
  return ignore.includes(filename) ? true : false;
}

function checkRequestType(filename) {
  if (!filename) return;

  const ext = path.extname(filename);

  if (ext === '.ts') {
    return 'segment';
  } else if (ext === '.m3u8') {
    // Going with a hardcoded check for now
    if (filename === 'media.m3u8') {
      return 'media';
    } else if (filename === 'rendition.m3u8') {
      return 'rendition';
    }
  }
}

// Parses the path to pull out the operations. Changes:
// '/s5-p30-r10/' to [{ op: 'startup', time: 5 }, { op: 'playback', time: 30 }, { op: 'rebuffer', time: 10 }]
function parseSpec(path) {
  if (!path) return;

  const opString = path.startsWith('/') ? path.substring(1) : path;
  const rawOps = opString.split('-');
  var ops = [];

  for (const rawOp of rawOps) {
    var op = parseOp(rawOp);

    if (op) {
      ops.push(op);
    }
  }

  console.dir(ops);
  return ops;
}

// Processes the operation specification and generates the actions for each segment.
// Outputs an array with the action for each segment file. The filename is the index 
// into the segment e.g. [{ segment: 0, delay: X }] is for 0.ts, etc.
// Currently, 'delay' and 'failure' are the only commands: 
//   [{ segment: 0, delay: 5 }, { segment: 5, failure: 404 }, ...]
function createSegmentTimeline(operations) {
  var timeline = [];
  var currentSegment = 0;

  if (!operations) return timeline;

  for (let i = 0; i < operations.length; i++) {
    switch (operations[i].op) {
      case 'startup':
        // Hardcode startup to first segment
        timeline.push({ segment: 0, delay: operations[i].time });
        currentSegment++;
        break;
      case 'playback':
        // No action to take for nominal playback
        currentSegment += Math.ceil(operations[i].time / segmentLength);
        break;
      case 'rebuffer':
        timeline.push({ segment: currentSegment, delay: operations[i].time });
        currentSegment++;
        break;
      case 'error':
        timeline.push({ 
          segment: currentSegment, 
          error: (operations[i].code ? operations[i].code : '500') 
        });
        currentSegment++;
        break;
      default:
        break;
    }
  }

  return timeline;
}

function calculateMediaLength(operations) {
  if (!operations) return;

  return operations.reduce((total, operation) => 
    total + roundToSegmentSize((operation.op === 'playback' ? operation.time : 0)), 0);
}

function roundToSegmentSize(length) {
  return Math.ceil(length / segmentLength) * segmentLength;
}

function parseOp(opString) {
  var op = {};

  const data = parseData(opString.substring(1));
  switch (opString.charAt(0)) {
    case 's':
        op['op'] = 'startup';
        op['time'] = data;
        break;
    case 'p':
        op['op'] = 'playback';
        op['time'] = data;
        break;
    case 'r':
        op['op'] = 'rebuffer';
        op['time'] = data;
        break;
    case 'e':
        op['op'] = 'error';
        if (data) op['code'] = data;
        break;
  };

  return op;
}

function parseData(dataString) {
  if (dataString) {
    return parseInt(dataString);
  }
}

async function outputFile(ctx, filepath, filename) {
  const fpath = path.join(__dirname, filepath, filename);
  const fstat = await stat(fpath);

  if (fstat.isFile()) {
    const temp = extname(fpath);
    var ext = temp.charAt(0) === '.' ? temp.substring(1) : temp;
    ext = ext === 'm3u8' ? 'application/x-mpegURL' : ext;

    ctx.type = ext;
    ctx.length = fstat.size;
    ctx.body = fs.createReadStream(fpath);
  }
}

async function outputError(ctx, code) {
  ctx.throw(code);
}

/**
 * thunkify stat
 */

function stat(file) {
  return new Promise(function(resolve, reject) {
    fs.stat(file, function(err, stat) {
      if (err) {
        reject(err);
      } else {
        resolve(stat);
      }
    });
  });
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
