import React, { useEffect, useCallback, useState } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";

const RoomPage = () => {
  const socket = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState();
  const [remoteStream, setRemoteStream] = useState();

  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`Email ${email} joined room`);
    setRemoteSocketId(id);
  }, []);

  const handleCallUser = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    const offer = await peer.getOffer();
    socket.emit("user:call", { to: remoteSocketId, offer });
    setMyStream(stream);
  }, [remoteSocketId, socket]);

  const handleIncommingCall = useCallback(
    async ({ from, offer }) => {
      setRemoteSocketId(from);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setMyStream(stream);
      console.log(`Incoming Call`, from, offer);
      const ans = await peer.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans });
    },
    [socket]
  );

  const sendStreams = useCallback(() => {
    for (const track of myStream.getTracks()) {
      peer.peer.addTrack(track, myStream);
    }
  }, [myStream]);

  const handleCallAccepted = useCallback(
    ({ from, ans }) => {
      peer.setLocalDescription(ans);
      console.log("Call Accepted!");
      sendStreams();
    },
    [sendStreams]
  );

  const handleNegoNeeded = useCallback(async () => {
    const offer = await peer.getOffer();
    socket.emit("peer:nego:needed", { offer, to: remoteSocketId });
  }, [remoteSocketId, socket]);

  useEffect(() => {
    peer.peer.addEventListener("negotiationneeded", handleNegoNeeded);
    return () => {
      peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
    };
  }, [handleNegoNeeded]);

  const handleNegoNeedIncomming = useCallback(
    async ({ from, offer }) => {
      const ans = await peer.getAnswer(offer);
      socket.emit("peer:nego:done", { to: from, ans });
    },
    [socket]
  );

  useEffect(() => {
    const retryFun = async () => {
      while (peer.peer.iceConnectionState === "disconnected") {
        console.log("Attempt to reconnect in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait for 10 seconds

        console.log("Attempting reconnect...");
        try {
          if (peer.peer.remoteDescription.type === "answer") {
            await peer.peer.setLocalDescription();
            await peer.peer.setRemoteDescription(peer.peer.remoteDescription);
          } else {
            await peer.peer.setRemoteDescription(peer.peer.remoteDescription);
            await peer.peer.setLocalDescription();
          }
        } catch (error) {
          console.error("Reconnect attempt failed:", error);
          // Handle error or retry logic if needed
        }
      }
    };
    retryFun();
  }, [peer.peer.iceConnectionState]);

  const handleNegoNeedFinal = useCallback(async ({ ans }) => {
    await peer.setLocalDescription(ans);
  }, []);

  const hangUpCall = () => {
    alert("hangUpCall");
  };

  const handleICEConnectionStateChangeEvent = async (event) => {
    setIsOnline(false);
    console.log(
      "*** ICE connection state changed to ==>",
      peer.peer,
      peer.peer.iceConnectionState
    );

    switch (peer.peer.iceConnectionState) {
      case "closed": // This means connection is shut down and no longer handling requests.
        hangUpCall(); //Hangup instead of closevideo() because we want to record call end in db
        break;
      case "failed":
        checkStatePermanent("failed");
        break;
      case "disconnected":
        checkStatePermanent("disconnected");
        break;
    }
  };

  const customdelay = (ms) => new Promise((res) => setTimeout(res, ms));

  const checkStatePermanent = async (iceState) => {
    videoReceivedBytetCount = 0;
    audioReceivedByteCount = 0;

    let firstFlag = await isPermanentDisconnect();

    await customdelay(2000);

    let secondFlag = await isPermanentDisconnect(); //Call this func again after 2 seconds to check whether data is still coming in.

    if (secondFlag) {
      //If permanent disconnect then we hangup i.e no audio/video is fllowing
      if (iceState == "disconnected") {
        hangUpCall(); //Hangup instead of closevideo() because we want to record call end in db
      }
    }
    if (!secondFlag) {
      //If temp failure then restart ice i.e audio/video is still flowing
      if (iceState == "failed") {
        peer.peer.restartIce();
        setIsOnline(true);
      }
    }
  };

  var videoReceivedBytetCount = 0;
  var audioReceivedByteCount = 0;

  const isPermanentDisconnect = async () => {
    var isPermanentDisconnectFlag = false;
    var videoIsAlive = false;
    var audioIsAlive = false;

    await peer.peer.getStats(null).then((stats) => {
      stats.forEach((report) => {
        if (
          report.type === "inbound-rtp" &&
          (report.kind === "audio" || report.kind === "video")
        ) {
          //check for inbound data only
          if (report.kind === "audio") {
            //Here we must compare previous data count with current
            if (report.bytesReceived > audioReceivedByteCount) {
              // If current count is greater than previous then that means data is flowing to other peer. So this disconnected or failed ICE state is temporary
              audioIsAlive = true;
            } else {
              audioIsAlive = false;
            }
            audioReceivedByteCount = report.bytesReceived;
          }
          if (report.kind === "video") {
            if (report.bytesReceived > videoReceivedBytetCount) {
              // If current count is greater than previous then that means data is flowing to other peer. So this disconnected or failed ICE state is temporary
              videoIsAlive = true;
            } else {
              videoIsAlive = false;
            }
            videoReceivedBytetCount = report.bytesReceived;
          }
          if (audioIsAlive || videoIsAlive) {
            //either audio or video is being recieved.
            isPermanentDisconnectFlag = false; //Disconnected is temp
          } else {
            isPermanentDisconnectFlag = true;
          }
        }
      });
    });

    return isPermanentDisconnectFlag;
  };

  const handleOnline = () => {
    // setIsOnline(true);
    console.log("back to online");
  };

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    console.log("isOnline", isOnline);
    if (!navigator.onLine) {
      handleICEConnectionStateChangeEvent();
    }

    window.addEventListener("online", handleOnline);
    // window.addEventListener("offline", handleICEConnectionStateChangeEvent);

    // Cleanup event listeners on component unmount
    return () => {
      window.removeEventListener("online", handleOnline);
      // window.removeEventListener(
      //   "offline",
      //   handleICEConnectionStateChangeEvent
      // );
    };
  }, [isOnline]);

  useEffect(() => {
    peer.peer.addEventListener("track", async (ev) => {
      const remoteStream = ev.streams;
      console.log("GOT TRACKS!!");
      setRemoteStream(remoteStream[0]);
    });
  }, []);

  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incomming:call", handleIncommingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:nego:needed", handleNegoNeedIncomming);
    socket.on("peer:nego:final", handleNegoNeedFinal);
    socket.on("peer:tempdisconnect", handleICEConnectionStateChangeEvent);

    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incomming:call", handleIncommingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:nego:needed", handleNegoNeedIncomming);
      socket.off("peer:nego:final", handleNegoNeedFinal);
      socket.off("peer:tempdisconnect", handleICEConnectionStateChangeEvent);
    };
  }, [
    socket,
    handleUserJoined,
    handleIncommingCall,
    handleCallAccepted,
    handleNegoNeedIncomming,
    handleNegoNeedFinal,
  ]);

  console.log(peer.peer.iceConnectionState);

  return (
    <div>
      <h1>Room Page</h1>
      <h4>{remoteSocketId ? "Connected" : "No one in room"}</h4>
      {myStream && <button onClick={sendStreams}>Send Stream</button>}
      {remoteSocketId && <button onClick={handleCallUser}>CALL</button>}
      {myStream && (
        <>
          <h1>My Stream</h1>
          <ReactPlayer
            playing
            muted
            height="100px"
            width="200px"
            url={myStream}
          />
        </>
      )}
      {remoteStream && (
        <>
          <h1>Remote Stream</h1>
          <ReactPlayer
            playing
            muted
            height="100px"
            width="200px"
            url={remoteStream}
          />
        </>
      )}
    </div>
  );
};

export default RoomPage;
