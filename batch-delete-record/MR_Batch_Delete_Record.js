/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Batch Delete Records — Map/Reduce Worker
 * ──────────────────────────────────────────
 * Reads JSON file from File Cabinet → deletes each record in map stage
 *
 * Script Parameter:
 *   custscript_bd_mr_file_id  (Integer) — File Cabinet ID of the JSON batch file
 *
 * Deploy:
 *   Script ID:  customscript_mr_batch_delete
 *   Deploy ID:  customdeploy_mr_batch_delete  (+ customdeploy_mr_batch_delete2, etc.)
 *   Status:     Released
 *   Log Level:  Debug
 */
define([
    'N/record',
    'N/log',
    'N/file',
    'N/runtime'
], (record, log, file, runtime) => {

    /**
     * getInputData — Load JSON file → return array of { id, recordType, tranid, trandate }
     */
    function getInputData() {
        const fileId = runtime.getCurrentScript().getParameter({ name: 'custscript_bd_mr_file_id' });
        if (!fileId) {
            log.error('getInputData', 'No file ID parameter');
            return [];
        }
        try {
            const f = file.load({ id: fileId });
            const items = JSON.parse(f.getContents());
            log.audit('getInputData', `Loaded ${items.length} records from file #${fileId}`);
            return items;
        } catch (e) {
            log.error('getInputData Error', e.message);
            return [];
        }
    }

    /**
     * map — Delete one record
     * Input value = JSON string of { id, recordType, tranid, trandate }
     */
    function map(context) {
      
        const data = JSON.parse(context.value);
        const { id, recordType, tranid } = data;

        try {
            record.delete({ type: recordType, id: Number(id) });
            log.audit('map:deleted', `${recordType} #${id} (${tranid || ''})`);
            context.write({
                key: String(id),
                value: JSON.stringify({ success: true, recordType, tranid })
            });
        } catch (e) {
            log.error('map:error', `${recordType} #${id}: ${e.message}`);
            context.write({
                key: String(id),
                value: JSON.stringify({ success: false, recordType, tranid, error: e.message })
            });
        }
    }

    /**
     * summarize — Count results, log summary, update the JSON file with results
     */
    function summarize(summary) {
        let okCount = 0, errCount = 0;
        const errors = [];

        summary.output.iterator().each((key, value) => {
            const data = JSON.parse(value);
            if (data.success) {
                okCount++;
            } else {
                errCount++;
                errors.push({ id: key, recordType: data.recordType, tranid: data.tranid, error: data.error });
            }
            return true;
        });

        // Also count map-stage errors (records that threw unhandled)
        summary.mapSummary.errors.iterator().each((key, error) => {
            errCount++;
            errors.push({ id: key, error: String(error) });
            return true;
        });

        const fileId = runtime.getCurrentScript().getParameter({ name: 'custscript_bd_mr_file_id' });

        // Write result summary back to a companion file
        try {
            const resultFile = file.create({
                name: `batch_delete_result_${fileId}.json`,
                fileType: file.Type.JSON,
                contents: JSON.stringify({
                    status: summary.status,
                    okCount,
                    errCount,
                    totalProcessed: okCount + errCount,
                    errors: errors.slice(0, 500), // cap at 500 for file size
                    usage: summary.usage,
                    concurrency: summary.concurrency,
                    completedAt: new Date().toISOString()
                }),
                folder: getFileFolder(fileId),
                description: `Batch Delete result for file #${fileId}`
            });
            const resultFileId = resultFile.save();
            log.audit('summarize', `Result file #${resultFileId} | OK:${okCount} ERR:${errCount} | Usage:${summary.usage}`);
        } catch (e) {
            log.error('summarize:writeResult', e.message);
        }

        log.audit('summarize', `${summary.status} | OK:${okCount} ERR:${errCount} | Usage:${summary.usage} | Concurrency:${summary.concurrency}`);
    }

    /**
     * Get the folder ID of an existing file
     */
    function getFileFolder(fileId) {
        try {
            const f = file.load({ id: fileId });
            return f.folder;
        } catch (e) {
            return -15; // SuiteScripts default folder fallback
        }
    }

    return { getInputData, map, summarize };
});