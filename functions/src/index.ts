import * as functions from 'firebase-functions';
import { PathReporter } from 'io-ts/lib/PathReporter';
import { isRight } from 'fp-ts/lib/Either';

import { runAnalytics } from '../../app/lib/analytics';
import { queueEmails } from './queueEmails';
import { handlePuzzleUpdate } from '../../app/lib/puzzleUpdate';
import { doGlicko } from '../../app/lib/glicko';
import { moderateComments } from '../../app/lib/comments';

import {
  CronStatusV,
  CronStatusT,
  CommentForModerationV,
  AdminSettingsV,
} from '../../app/lib/dbtypes';

import {
  getCollection,
  mapEachResult,
  toFirestore,
} from '../../app/lib/firebaseAdminWrapper';
import { Timestamp } from '../../app/lib/timestamp';

export const ratings = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every day 00:05')
  .timeZone('UTC')
  .onRun(async (_context) => {
    await doGlicko();
    return;
  });

export const autoModerator = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async (_context) => {
    console.log('running automoderator');
    const settingsDoc = await getCollection('settings').doc('settings').get();
    const result = AdminSettingsV.decode(settingsDoc.data());
    if (!isRight(result)) {
      console.error(PathReporter.report(result).join(','));
      throw new Error('Malformed admin settings');
    }
    const settings = result.right;

    if (!settings.automoderate) {
      console.log('automoderation is turned off, done');
      return;
    }

    const commentsForModeration = await mapEachResult(
      getCollection('cfm'),
      CommentForModerationV,
      (cfm, docId) => {
        return { ...cfm, i: docId };
      }
    );

    const filtered = commentsForModeration.filter(
      (cfm) => !settings.noAuto.includes(cfm.a)
    );

    console.log(
      `have ${commentsForModeration.length} comments, automoderating ${filtered.length} of them`
    );

    await moderateComments(
      filtered,
      new Set(),
      (cid) => getCollection('cfm').doc(cid).delete(),
      (puzzleId, update) =>
        getCollection('c').doc(puzzleId).update(toFirestore(update)),
      (commentId, comment) =>
        getCollection('automoderated').doc(commentId).create(comment)
    );

    console.log('done');
    return;
  });

export const analytics = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (_context) => {
    let startTimestamp = Timestamp.fromDate(new Date(2020, 0));
    const endTimestamp = Timestamp.now();
    const value = await getCollection('cron_status')
      .doc('hourlyanalytics')
      .get();
    const data = value.data();
    if (data) {
      const result = CronStatusV.decode(data);
      if (!isRight(result)) {
        console.error(PathReporter.report(result).join(','));
        throw new Error('Malformed cron_status');
      }
      startTimestamp = result.right.ranAt;
    }
    await runAnalytics(startTimestamp, endTimestamp);
    const status: CronStatusT = { ranAt: endTimestamp };
    console.log('Done, logging analytics timestamp');
    return getCollection('cron_status').doc('hourlyanalytics').set(status);
  });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const firestore = require('@google-cloud/firestore');
const client = new firestore.v1.FirestoreAdminClient();

export const scheduledFirestoreExport = functions.pubsub
  .schedule('every day 00:00')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  .onRun((_context) => {
    const projectId =
      process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT || 'mdcrosshare';
    const databaseName = client.databasePath(projectId, '(default)');

    return client
      .exportDocuments({
        name: databaseName,
        outputUriPrefix: 'gs://crosshare-backups',
        // Leave collectionIds empty to export all collections
        // or set to a list of collection IDs to export,
        // collectionIds: ['users', 'posts']
        collectionIds: [
          'a', // articles
          'c', // puzzles
          'cp', // blogs
          'cs', // constructor stats
          'donations',
          'ds', // daily stats
          'em', // embed settings
          'followers',
          'prefs',
          's', // puzzle stats
          'settings',
        ],
      })
      .then((responses: any) => {
        const response = responses[0];
        console.log(`Operation Name: ${response['name']}`);
      })
      .catch((err: any) => {
        console.error(err);
        throw new Error('Export operation failed');
      });
  });

export const notificationsSend = functions.pubsub
  .schedule('every day 16:00')
  .onRun(async () => {
    console.log('queuing emails');
    await queueEmails();
    console.log('queued');
  });

export const puzzleUpdate = functions.firestore
  .document('c/{puzzleId}')
  .onWrite(async (change) => {
    if (!change.after.exists) {
      return;
    }
    console.log('Puzzle written, checking for notifications');
    const newValue = change.after.data();
    const previousValue = change.before.data();
    await handlePuzzleUpdate(previousValue, newValue, change.after.id);
  });
