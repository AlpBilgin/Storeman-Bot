import { Client, Message, ActionRowBuilder, TextChannel, ButtonBuilder } from "discord.js"
import { getCollections } from '../mongoDB';
import checkTimeNotifsQueue from "./checkTimeNotifs";
let queue: Array<any> = []
let multiServerQueue: any = {}
let editedMsgs = false
let newMsgsSent = false
const eventName = "[Update Logi Channel]: "

const updateStockpileMsgEntryPoint = async (client: Client, guildID: string | null, msg: [string, Array<string>, string, string, ActionRowBuilder]): Promise<Boolean> => {
    if (process.env.STOCKPILER_MULTI_SERVER === "true") {


        if (!(guildID! in multiServerQueue)) multiServerQueue[guildID!] = []

        multiServerQueue[guildID!].push({ client: client, guildID: guildID, msg: msg })

        if (multiServerQueue[guildID!].length === 1) {
            console.log(eventName + "No queue ahead. Starting")

            updateStockpileMsg(multiServerQueue[guildID!][0].client, multiServerQueue[guildID!][0].guildID, multiServerQueue[guildID!][0].msg)
        }
        else {
            if (multiServerQueue[guildID!].length > 2) {
                console.log(eventName + "Queue length exceeded allowed quantity, skipping middle ones")
                multiServerQueue[guildID!].splice(1, multiServerQueue[guildID!].length - 1)
                
            }
            console.log(eventName + "Update event ahead queued, current length in queue: " + multiServerQueue[guildID!].length)
        }
    }
    else {
        queue.push({ client: client, guildID: guildID, msg: msg })

        if (queue.length === 1) {
            console.log(eventName + "No queue ahead. Starting")

            updateStockpileMsg(queue[0].client, queue[0].guildID, queue[0].msg)
        }
        else {
            if (queue.length > 2) {
                console.log(eventName + "Queue length exceeded allowed quantity, skipping middle ones")
                queue.splice(1, queue.length - 1)
            }
            console.log(eventName + "Update event ahead queued, current length in queue: " + queue.length)
        }
    }

    return true
}

const editStockpileMsg = async (currentMsg: string | [string, ActionRowBuilder<ButtonBuilder>], msgObj: Message): Promise<Boolean> => {

    try {
        if (typeof currentMsg !== "string") await msgObj.edit({ content: currentMsg[0], components: [currentMsg[1]] })
        else await msgObj.edit({ content: currentMsg, components: [] })
    }
    catch (e) {
        console.log(e)
        console.log(eventName + "Failed to edit a stockpile msg, it might no longer exist. Skipping...")
    }

    return true
}

const newStockpileMsg = async (currentMsg: string | [string, ActionRowBuilder<ButtonBuilder>], configObj: any, channelObj: TextChannel): Promise<Boolean> => {

    try {
        // The issue here is that when adding a new stockpile, a new msg has to be sent
        // Unfortunately, it takes a long time to send that new msg, hence when 2 requests to add the same new stockpile happen
        // The 1st request wouldn't have updated the database that a new msg has already been sent, leading to another new msg being sent
        // and the 2nd request's configObj.stockpileMsgs overrides the 1st one
        let newMsg: any;
        if (typeof currentMsg !== "string") newMsg = await channelObj.send({ content: currentMsg[0], components: [currentMsg[1]] })
        else newMsg = await channelObj.send(currentMsg)
        configObj.stockpileMsgs.push(newMsg.id)
        if (!editedMsgs) editedMsgs = true
        newMsgsSent = true

    }
    catch (e) {
        console.log(e)
        console.log(eventName + "Failed to send a stockpile msg, skipping...")
    }
    return true
}

const editTargetMsg = async (currentMsg: string, msgObj: Message) => {
    try {
        await msgObj.edit(currentMsg)
    }
    catch (e) {
        console.log(e)
        console.log(eventName + "Failed to edit a target msg, it might no longer exist. Skipping...")
    }
}

const newTargetMsg = async (currentMsg: string, channelObj: TextChannel, configObj: any) => {
    const newMsg = await channelObj.send(currentMsg)
    configObj.targetMsg.push(newMsg.id)
    if (!editedMsgs) editedMsgs = true
}

const deleteTargetMsg = async (channelObj: TextChannel, currentMsgID: string) => {
    try {
        const targetMsg = await channelObj.messages.fetch(currentMsgID)
        await targetMsg.delete()
    }
    catch (e) {
        console.log(e)
        console.log(eventName + "Failed to delete a targetMsg")
    }
}



const updateStockpileMsg = async (client: Client, guildID: string | null, msg: [string, Array<string>, Array<string>, string, ActionRowBuilder<ButtonBuilder>]): Promise<Boolean> => {
    try {
        const collections = process.env.STOCKPILER_MULTI_SERVER === "true" ? getCollections(guildID) : getCollections()

        const configObj = (await collections.config.findOne({}))!

        // update msg if logi channel is set
        if ("channelId" in configObj) {
            const channelObj = client.channels.cache.get(configObj.channelId) as TextChannel
            let msgObj: Message;
            try {
                msgObj = await channelObj.messages.fetch(configObj.stockpileHeader)
                await msgObj.edit(msg[0])
            }
            catch (e: any) {
                if (e.code === 10008) {
                    console.log(eventName + "Overall bot report header msg not found, sending a new one")
                    const newMsg = await channelObj.send(msg[0])
                    await collections.config.updateOne({}, { $set: { stockpileHeader: newMsg.id } })
                }
            }
            try {
                msgObj = await channelObj.messages.fetch(configObj.stockpileMsgsHeader)
                await msgObj.edit(msg[3])
            }
            catch (e: any) {
                if (e.code === 10008) {
                    console.log(eventName + "Stockpile msgs header msg not found, sending a new one")
                    const newMsg = await channelObj.send(msg[3])
                    await collections.config.updateOne({}, { $set: { stockpileMsgsHeader: newMsg.id } })
                }
            }

            // Check if all the stockpile msgs still exist
            for (let i = 0; i < configObj.stockpileMsgs.length; i++) {
                try {
                    await channelObj.messages.fetch(configObj.stockpileMsgs[i])
                }
                catch (e: any) {
                    if (e.code === 10008) {
                        configObj.stockpileMsgs.splice(i, 1)
                        i -= 1
                        console.log(eventName + "A stockpile msg no longer exists, deleting")
                        editedMsgs = true
                    }
                }
            }

            let updateStockpileFuncArray = []
            for (let i = 0; i < msg[1].length; i++) {
                if (i < configObj.stockpileMsgs.length) {
                    msgObj = await channelObj.messages.fetch(configObj.stockpileMsgs[i])
                    updateStockpileFuncArray.push(editStockpileMsg(msg[1][i], msgObj))
                }
                else {
                    updateStockpileFuncArray.push(newStockpileMsg(msg[1][i], configObj, channelObj))
                }
            }
            await Promise.all(updateStockpileFuncArray)

            const difference = configObj.stockpileMsgs.length - msg[1].length
            for (let i = 0; i < difference; i++) {
                if (!editedMsgs) editedMsgs = true
                try {
                    msgObj = await channelObj.messages.fetch(configObj.stockpileMsgs[configObj.stockpileMsgs.length - 1])
                    await msgObj.delete()
                }
                catch (e) {
                    console.log(eventName + "Failed to delete an unused stockpile msg")
                }
                configObj.stockpileMsgs.pop()

            }


            // Check if all the target msgs still exist
            for (let i = 0; i < configObj.targetMsg.length; i++) {
                try {
                    await channelObj.messages.fetch(configObj.targetMsg[i])
                }
                catch (e: any) {
                    console.log(e)
                    if (e.code === 10008) {
                        configObj.targetMsg.splice(i, 1)
                        i -= 1
                        console.log(eventName + "A target msg no longer exists, deleting")
                        editedMsgs = true
                        newMsgsSent = true
                    }
                }
            }

            let updateObj: any = {}

            // Send the refresh all stockpiles and target msg last
            if (newMsgsSent) {
                try {
                    const refreshAllID = await channelObj.messages.fetch(configObj.refreshAllID)
                    if (refreshAllID) await refreshAllID.delete()
                }
                catch (e) {
                    console.log("Failed to delete new refresh all button")
                }
                try {
                    const refreshAllID = await channelObj.send({ content: "----------\nRefresh the timer of **all stockpiles**", components: [msg[4]] })
                    updateObj.refreshAllID = refreshAllID.id

                } catch (e) {
                    console.log('Failed to send the refresh all button')
                }


                let targetMsgIDs = []
                let targetMsgFuncArray = []

                for (let i = 0; i < configObj.targetMsg.length; i++) {
                    targetMsgFuncArray.push(deleteTargetMsg(channelObj, configObj.targetMsg[i]))
                }
                await Promise.all(targetMsgFuncArray)
                for (let i = 0; i < msg[2].length; i++) {
                    try {
                        const targetMsg = await channelObj.send(msg[2][i])
                        targetMsgIDs.push(targetMsg.id)
                    }
                    catch (e) {
                        console.log(eventName + "Failed to send a new targetMsg")
                    }
                }
                updateObj.targetMsg = targetMsgIDs

                const disableTimeNotif: any = NodeCacheObj.get("disableTimeNotif")
                const timeCheckDisabled = process.env.STOCKPILER_MULTI_SERVER === "true" ? disableTimeNotif[guildID!] : disableTimeNotif

                if (!timeCheckDisabled) checkTimeNotifsQueue(client, true, false, guildID!)
            }
            else {
                try {
                // edit refreshAllID in case the button was pressed
                 const refreshAllMsg = await channelObj.messages.fetch(configObj.refreshAllID)
                 await refreshAllMsg.edit({ content: "----------\nRefresh the timer of **all stockpiles**", components: [msg[4]] })
                }
                catch (e: any) {
                    if (e.code === 10008) {
                        editedMsgs = true
                        console.log(eventName + "Refresh stockpile button not found, sending a new 1")
                        const newMsg =  await channelObj.send({ content: "----------\nRefresh the timer of **all stockpiles**", components: [msg[4]] })
                        await collections.config.updateOne({}, { $set: { refreshAllID: newMsg.id } })

                        let targetMsgIDs = []
                        let targetMsgFuncArray = []
        
                        for (let i = 0; i < configObj.targetMsg.length; i++) {
                            targetMsgFuncArray.push(deleteTargetMsg(channelObj, configObj.targetMsg[i]))
                        }
                        await Promise.all(targetMsgFuncArray)
                        for (let i = 0; i < msg[2].length; i++) {
                            try {
                                const targetMsg = await channelObj.send(msg[2][i])
                                targetMsgIDs.push(targetMsg.id)
                            }
                            catch (e) {
                                console.log(eventName + "Failed to send a new targetMsg")
                            }
                        }
                        updateObj.targetMsg = targetMsgIDs
        
                        const disableTimeNotif: any = NodeCacheObj.get("disableTimeNotif")
                        const timeCheckDisabled = process.env.STOCKPILER_MULTI_SERVER === "true" ? disableTimeNotif[guildID!] : disableTimeNotif
        
                        if (!timeCheckDisabled) checkTimeNotifsQueue(client, true, false, guildID!)
                    }
                }

                let targetMsgFuncArray = []
                for (let i = 0; i < msg[2].length; i++) {
                    if (i < configObj.targetMsg.length) {
                        const msgObj = await channelObj.messages.fetch(configObj.targetMsg[i])
                        targetMsgFuncArray.push(editTargetMsg(msg[2][i], msgObj))
                    }
                    else {
                        targetMsgFuncArray.push(newTargetMsg(msg[2][i], channelObj, configObj))
                    }
                }
                await Promise.all(targetMsgFuncArray)

                const difference2 = configObj.targetMsg.length - msg[2].length
                for (let i = 0; i < difference2; i++) {
                    if (!editedMsgs) editedMsgs = true
                    try {
                        msgObj = await channelObj.messages.fetch(configObj.targetMsg[configObj.targetMsg.length - 1])
                        await msgObj.delete()
                    }
                    catch (e) {
                        console.log(eventName + "Failed to delete last unused target msg. It might no longer exist")
                    }
                    configObj.targetMsg.pop()

                }
                updateObj.targetMsg = configObj.targetMsg
            }

            if (editedMsgs) {
                updateObj.stockpileMsgs = configObj.stockpileMsgs
                await collections.config.updateOne({}, { $set: updateObj })
            }


        }

    }
    catch (e) {
        console.log(e)
        console.log(eventName + "An error occurred updating msgs, skipping this update event for now...")
    }
    if (process.env.STOCKPILER_MULTI_SERVER === "true") {
        multiServerQueue[guildID!].splice(0, 1)
        // popping an item from the start of the array is actually O(n) i.e very slow
        // all the indexes have to be re-assigned since the removed item is at the front
        if (multiServerQueue[guildID!].length > 0) {
            console.log(eventName + "Finished 1 logi channel update for " + guildID + ", starting next in queue, remaining queue: " + multiServerQueue[guildID!].length)
            updateStockpileMsg(multiServerQueue[guildID!][0].client, multiServerQueue[guildID!][0].guildID, multiServerQueue[guildID!][0].msg)
        }
        else console.log(eventName + "All logi channel updates for " + guildID + " completed")
    }
    else {
        queue.splice(0, 1)
        if (queue.length > 0) {
            console.log(eventName + "Finished 1 logi channel update, starting next in queue, remaining queue: " + queue.length)
            updateStockpileMsg(queue[0].client, queue[0].guildID, queue[0].msg)
        }
        else console.log(eventName + "All logi channel updates completed")
    }
    editedMsgs = false
    newMsgsSent = false
    return true
}

export default updateStockpileMsgEntryPoint

