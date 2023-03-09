const app = require("./app")
const dotenv = require("dotenv");
const mongoose = require("mongoose")
const path  = require("path")

const { Server } = require("socket.io")

dotenv.config({ path: "./config.env" })

process.on("uncaughtException", (err) => {
    console.log(err);
    console.log("UNCAUGHT Exception! Shutting down ...");
    process.exit(1);
}); 3





const http = require("http");
const User = require("./models/user");
const FriendRequest = require("./models/friendRequest");
const OneToOneMessage = require("./models/OneToOneMessage")

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:3001",
        methods: ["GET", "POST"]
    }
})

const DB = process.env.DBURI.replace("<PASSWORD>", process.env.DBPASSWORD)

mongoose.connect(DB, {
    // useNewUrlParser: true,
    // useCreateIndex: true,
    // useFindAndModify: false,
    // useUnifiedToplogy: true,
}).then((con) => {
    console.log("DB connection is successful")
}).catch((err) => {
    console.log(err)
})

const port = process.env.PORT || 8000;

server.listen(port, () => {
    console.log(`App running on port ${port}`)
})

io.on("connection", async (socket) => {
    console.log(JSON.stringify(socket.handshake.query))
    // console.log(socket);
    const user_id = socket.handshake.query["user_id"];

    const socket_id = socket.id;

    console.log(`user connected ${socket_id}`);

    if (Boolean(user_id)) {
        await User.findByIdAndUpdate(user_id, { socket_id: socket_id,status: "Online" })
    }

    socket.on("friend_request", async (data) => {
        console.log(data.to);

        const to_user = await User.findById(data.to).select("socket_id");
        const from_user = await User.findById(data.from).select("socket_id")


        //TODO => Create a frnd req

        await FriendRequest.create({
            sender: data.from,
            recipient: data.to,
        })

        //emit event => "new_friend_request"

        io.to(to_user.socket_id).emit("new_friend_request", {

            message: "New Friend Request Received"

        });
        //emit event => "request sent"
        io.to(from_user.socket_id).emit("request_sent", {
            message: "Request sent successfully"
        })
    })

    socket.on("accept_request", async (data) => {
        console.log(data);

        const request_doc = await FriendRequest.findById(data.request_id);

        console.log(request_doc);
        // request_id

        const sender = await User.findById(request_doc.sender);
        const receiver = await User.findById(request_doc.recipient);

        sender.friends.push(request_doc.recipient);
        receiver.friends.push(request_doc.sender);


        await receiver.save({ new: true, validateModifiedOnly: true });
        await sender.save({ new: true, validateModifiedOnly: true });

        await FriendRequest.findByIdAndDelete(data.request_id);

        io.to(sender.socket_id).emit("request_accepted", {
            message: "Friend Request Accepted",
        })
        io.to(receiver.socket_id).emit("request_accepted", {
            message: "Friend Request Accepted",
        })



    })

    socket.on("get_direct_conversations",async({user_id},callback) => {
        const existing_conversations = await OneToOneMessage.find({
            participants: {$all: [user_id]},
        }).populate("participants","firstName lastName _id email status");

        console.log(existing_conversations)

        callback(existing_conversations);
    })

    socket.on("start_conversation",async (data) => {
        const {to,from} = data;
        const existing_conversations = await OneToOneMessage.find({
            participants: {$size: 2,$all: [to,from]}
        }).populate("participants","firstName lastName _id email status")

        console.log(existing_conversations[0],"Existing Conversation");

        //if there is no existing_conv

        if(existing_conversations.length === 0){
            let new_chat = await OneToOneMessage.create({
                participants: [to,from],
            });

            new_chat = await OneToOneMessage.findById(new_chat._id).populate("participants","firstName lastName _id email status")

            console.log(new_chat);

            socket.emit("$start_chat",new_chat);
        }

        //if there is exis_conv

        else{
            socket.emit("start_chat",existing_conversations[0]);
        }
    })

    socket.on("get_messages",async (data,callback) => {
      const {messages} = await OneToOneMessage.findById(data.conversation_id).select("messages");
      callback(messages);
    })

    // Handle text/link messages

    socket.on("text_message",async(data) => {
        console.log("Received Message",data);

        //data:{to,from,message,coversation_id,type}

        const {to,from,message,conversation_id,type} = data;

        const to_user = await User.findById(to);
        const from_user = await User.findById(from);

        const new_message ={
            to,
            from,
            type,
            text: message,
            created_at:Date.now()
        }



        //create a new conversation if it dosen't exist yet or add new message to the messages list
        await OneToOneMessage.findById(conversation_id);
        Chat,messages.push(new_message);
        //save to db

        await chat.save({});

        //emit incoming_message -> to user

        io.to(to_user.socket_id).emit("new_message",{
            conversation_id,
            message:new_message,
        })


        //emit outgoing_message -> from user

        io.to(from_user.socket_id).emit("new_message",{
            conversation_id,
            message:new_message,
        })
    });

    socket.on("file_message",(data) => {
        console.log("Received Message",data);

        //data: {to,from,text,file}

        //get the file extension

        const fileExtension = path.extname(data.file.name);

        //generate a unique filename

        const fileName = `${Date.now()}_${Math.floor(Math.random() * 10000)}${fileExtension}`

        //  upload it to AWS 

    
    })

    socket.on("end", async (data) =>  {

        //Find user by _id and set the status to offline
        if (data.user_id){
            await User.findByIdAndUpdate(data.user_id,{status: "Offline"});
        }
        // brodcast user_disconnected
        console.log("Closing connection");
        socket.disconnect(0);
    })


})

process.on("unhandledRejection", (err) => {
    console.log(err);
    console.log("UNHANDLED REJECTION! Shutting down ...");
    server.close(() => {
        process.exit(1)
    })
})