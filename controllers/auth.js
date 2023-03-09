const jwt = require("jsonwebtoken");
const otpGenerator = require('otp-generator')
const crypto = require('crypto')
const mailService = require("../services/mailer")
const otp = require("../Templates/Mail/otp");

// 
const User = require("../models/user");
const filterObj = require("../utils/filterObj");
const { promisify } = require("util");
const resetPassword = require("../Templates/Mail/resetPassword");
const AppError = require("../utils/AppError");

const signToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

//Register new User
exports.register = async (req, res, next) => {
    const { firstName, lastName, email, password } = req.body;

    const filteredBody = filterObj(req.body, "firstName", "lastName","email", "password");

    // check if a verified user with given email exists 
    const existing_user = await User.findOne({ email: email });

    if (existing_user && existing_user.verified) {
        res.status(400).json({
            status: "error",
            message: "Email is already in use,Please login.",
        })
    }
    else if (existing_user) {
        await User.findOneAndUpdate({ email: email }, filteredBody, { new: true, validateModifiedOnly: true });
        //
        req.userId = existing_user._id;
        next()
    }
    else {

        //if user record is not available in DB

        const new_user = await User.create(filteredBody);

        //generate OTP and send email to user

        req.userId = new_user._id;

        next();

    }

}

exports.sendOTP = async (req, res, next) => {
    const { userId } = req;
    const new_otp = otpGenerator.generate(6, { 
        lowerCaseAlphabets: false, 
        upperCaseAlphabets: false, 
        specialChars: false 
    });

    const otp_expiry_time = Date.now() + 10 * 60 * 1000;//10 min after otp is sent

    const user = await User.findByIdAndUpdate(userId, {
        otp_expiry_time: otp_expiry_time,
    })

    user.otp = new_otp.toString();

    await user.save({ new: true, validateModifiedOnly: true });

    console.log(new_otp);


    // TODO Send Mail

    mailService.sendEmail({
        from: "radiance546@gmail.com",
        to: user.email,
        subject: "OTP For Radiance",
        html: otp(user.firstName,new_otp),
        attachments: [],
    })

    res.status(200).json({
        status: "success",
        message: "OTP sent successfully!",
    });

};

exports.verifyOTP = async (req, res, next) => {
    //verify OTP and update user record accordingly
    const { email, otp } = req.body;
    const user = await User.findOne({
        email,
        otp_expiry_time: { $gt: Date.now() },
    });

    if (!user) {
        return res.status(400).json({
                status: "error",
                message: "Email is Invalid or OTP expired",
            })
    }
    
    if (user.verified) {
        return res.status(400).json({
            status: "error",
            message: "Email is already verified",
        });

    }
    if(!(await user.correctOTP(otp, user.otp))){
        res.status(400).json({
            status: "error",
            message: "OTP is incorrect",
        })

        return;
    }

    //OTP is correct
    user.verified = true;
    user.otp = undefined;
    await user.save({ new: true, validateModifiedOnly: true })

    const token = signToken(user._id);

    res.status(200).json({
        status: "success",
        message: "OTP verified successfully!",
        token,
        user_id: user._id,
    });

};

exports.protect = async (req, res, next) => {
    // Getting a token {JWT} and check if it's there

    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        token = req.headers.authorization.split(" ")[1];


    }
    else if (req.cookies.jwt) {
        token = req.cookies.jwt;

    }
    if (!token) {
        return next(
          new  AppError(`You are not logged in! Please log in to get access.`, 401)
        );
      }
    //verification of token

    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    console.log(decoded)

    //Check if user still exist

    const this_user = await User.findById(decoded.userId);

    if (!this_user) {
        return next(
          new AppError(
            "The user belonging to this token does no longer exists.",
            401
          )
        );
      }

    //check if user changed their password after token was issued

    if (this_user.changedPasswordAfter(decoded.iat)) {
        return next(
            new AppError("User recently changed password! Please log in again.", 401)
          );
    }

    //
    req.user = this_user
    next()





}

//Types of routes -> protected(Only logged in ussers can accesss these) & Unprotected

exports.forgotPassword = async (req, res, next) => {
    // Get user email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
        return res.status(404).json({
            status: "error",
            message: "There is no user with given email address"
        })
    }

    //Generate the random reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({validateBeforeSave: false})


    try {
    const resetURL = `http://localhost:3001/auth/new-password?token=${resetToken}`;;

    console.log(resetToken)

        //TODO => Send Email with reset URL
        mailService.sendEmail({
            from: "arnabdutta8986@gmail.com",
            to: user.email,
            subject: "Reset Password",
            html: resetPassword(user.firstName,resetURL),
            attachments: [],
        })

        res.status(200).json({
            status: "success",
            message: "Reset Password link sent to Email",
        })

    }
    catch (error) {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;

        await user.save({ validateBeforeSave: false });

        return next(
            new AppError("There was an error sending the email. Try again later!"),
            500
          );
    }

    //

}

exports.resetPassword = async (req, res, next) => {
    // Get the user based on token
    const hashedToken = crypto.createHash("sha256").update(req.body.token).digest("hex")
    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },
    })

    // If token has expired or submission is out of time window

    if (!user) {
        return res.status(400).json({
            status: "error",
            message: "Token is Invalid or Expired",
        })
        
    }

    //Update users password and set resetToken & expiry to undefined
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();
    // Log in the user and send new JWT

    //send an email to user informing about password reset

    const token = signToken(user._id);

    res.status(200).json({
        status: "success",
        message: "Password Reset Sucessfull",
        token,
    })





}

exports.login = async (req, res, next) => {
    // 
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({
            status: "error",
            message: "Both email and password are required"
        })
        return;
    }
    const userDoc = await User.findOne({ email: email }).select("+password");
    if (!userDoc || !(await userDoc.correctPassword(password, userDoc.password))) {
        res.status(400).json({
            status: "error",
            message: "Email or password is incorrect"
        })
        return;
    }

    const token = signToken(userDoc._id);

    res.status(200).json({
        status: "success",
        message: "Logged in successfully",
        token,
        user_id: userDoc._id,
    })

}